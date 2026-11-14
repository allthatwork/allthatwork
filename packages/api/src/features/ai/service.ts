import type { ModelCallOptions } from "./request-limits";
import type { AiReasoning } from "@reactive-resume/ai/reasoning";
import type { AIProvider } from "@reactive-resume/ai/types";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { LanguageModel, ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createCerebras } from "@ai-sdk/cerebras";
import { createCohere } from "@ai-sdk/cohere";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createFireworks } from "@ai-sdk/fireworks";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createPerplexity } from "@ai-sdk/perplexity";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createXai } from "@ai-sdk/xai";
import { APICallError, createGateway, generateText, LoadAPIKeyError, NoSuchModelError, wrapLanguageModel } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import { match } from "ts-pattern";
import { z } from "zod";
import {
	docxParserSystemPrompt,
	docxParserUserPrompt,
	pdfParserSystemPrompt,
	pdfParserUserPrompt,
} from "@reactive-resume/ai/prompts";
import { aiReasoningSchema } from "@reactive-resume/ai/reasoning";
import { buildAiExtractionTemplate } from "@reactive-resume/ai/resume/extraction-template";
import { sanitizeAndParseResumeJson } from "@reactive-resume/ai/resume/sanitize";
import { AI_PROVIDER_DEFAULT_BASE_URLS, AI_PROVIDER_DISPLAY_NAMES, aiProviderSchema } from "@reactive-resume/ai/types";
import { ZipEntryTooLargeError, unzipEntries } from "@reactive-resume/import/zip";
import { decodeEntities } from "../web-access/builtin";
import { isDirectOpenAIProvider } from "./capabilities";
import { aiDeadline } from "./generate-json";
import { sdkCallSettings } from "./request-limits";
import { aiTransport, resolveAiBaseUrl } from "./url-policy";

const aiExtractionTemplate = buildAiExtractionTemplate();

function logAndRethrow(context: string, error: unknown): never {
	if (error instanceof Error) {
		console.error(`${context}:`, error);
		throw error;
	}

	console.error(`${context}:`, error);
	throw new Error(`An unknown error occurred during ${context}.`);
}

function parseAndValidateResumeJson(resultText: string): ResumeData {
	const { data, diagnostics } = sanitizeAndParseResumeJson(resultText);

	if (diagnostics.coercions.length === 0 && diagnostics.droppedSectionItems.length === 0) return data;

	const droppedBySection = diagnostics.droppedSectionItems.reduce<Record<string, number>>((acc, item) => {
		acc[item.section] = (acc[item.section] ?? 0) + 1;
		return acc;
	}, {});

	console.info("AI resume sanitization diagnostics", {
		coercions: diagnostics.coercions.length,
		droppedBySection,
		salvageApplied: diagnostics.salvageApplied,
	});

	return data;
}

type GetModelInput = {
	provider: AIProvider;
	model: string;
	apiKey: string;
	baseURL?: string;
	/** The connection's reasoning setting; null or absent sends nothing (Model default). */
	reasoning?: AiReasoning | null | undefined;
	/** The connection's context window in tokens, when it has one. Ollama loads the model with it. */
	contextTokens?: number | null | undefined;
};

const MAX_AI_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_AI_FILE_BASE64_CHARS = Math.ceil((MAX_AI_FILE_BYTES * 4) / 3) + 4;
const TEST_CONNECTION_MAX_OUTPUT_TOKENS = 128;
const TEST_CONNECTION_REASONING_MAX_OUTPUT_TOKENS = 4096;

// AbortSignal.timeout stores the delay as a 32-bit signed integer.
const MAX_ABORT_SIGNAL_TIMEOUT_MS = 2_147_483_647;

// Long enough for a cold local model to load, short enough that the UI does not look frozen.
// Self-hosted deployments with cold-start models (e.g. Ollama) can override via AI_TEST_TIMEOUT_MS.
const TEST_CONNECTION_TIMEOUT_MS = z.coerce
	.number()
	.int()
	.nonnegative()
	.max(MAX_ABORT_SIGNAL_TIMEOUT_MS)
	.catch(30_000)
	.parse(process.env.AI_TEST_TIMEOUT_MS?.trim() || undefined);
const DOCX_DOCUMENT_XML_PATH = "word/document.xml";
// Resume bodies are kilobytes; this leaves room for long documents without trusting the archive's declared size.
const MAX_DOCX_DOCUMENT_XML_BYTES = 20 * 1024 * 1024;

/**
 * Sends the connection's reasoning setting with every call: the AI SDK translates the standard levels for each
 * provider; Ultra, which it doesn't list, goes to OpenAI-compatible servers as-is as `reasoning_effort`.
 */
function withReasoning<T extends Exclude<LanguageModel, string>>(input: GetModelInput, model: T) {
	const { reasoning, provider } = input;
	if (!reasoning) return model;
	return wrapLanguageModel({
		model,
		middleware: {
			transformParams: ({ params }) =>
				Promise.resolve(
					reasoning === "ultra"
						? {
								...params,
								providerOptions: {
									...params.providerOptions,
									[provider]: { ...params.providerOptions?.[provider], reasoningEffort: reasoning },
								},
							}
						: { ...params, reasoning },
				),
		},
	});
}

/**
 * Ollama runs every request in the model's own default context (often 4,096 tokens or less) and silently drops the start
 * of a longer prompt, unless the request says how big a window to load. Sends the connection's context window as
 * `num_ctx` when it has one, keeping any other Ollama options the request carries.
 */
function withOllamaContext<T extends Exclude<LanguageModel, string>>(input: GetModelInput, model: T) {
	const { provider, contextTokens } = input;
	if (provider !== "ollama" || !contextTokens) return model;
	return wrapLanguageModel({
		model,
		middleware: {
			transformParams: ({ params }) => {
				const ollama = params.providerOptions?.ollama ?? {};
				const options =
					ollama.options && typeof ollama.options === "object" && !Array.isArray(ollama.options) ? ollama.options : {};
				return Promise.resolve({
					...params,
					providerOptions: {
						...params.providerOptions,
						ollama: { ...ollama, options: { ...options, num_ctx: contextTokens } },
					},
				});
			},
		},
	});
}

export function getModel(input: GetModelInput) {
	return withReasoning(input, withOllamaContext(input, createModel(input)));
}

function createModel(input: GetModelInput) {
	const { provider, model, apiKey } = input;
	const baseURL = resolveAiBaseUrl(input);
	const settings = { apiKey, baseURL, ...aiTransport() };

	return match(provider)
		.with("openai", () => createOpenAI(settings).chat(model))
		.with("anthropic", () => createAnthropic(settings).languageModel(model))
		.with("gemini", () => createGoogleGenerativeAI(settings).languageModel(model))
		.with("vercel-ai-gateway", () => createGateway(settings).languageModel(model))
		.with("openrouter", () => createOpenAICompatible({ name: "openrouter", ...settings }).languageModel(model))
		.with("mistral", () => createMistral(settings).languageModel(model))
		.with("cohere", () => createCohere(settings).languageModel(model))
		.with("xai", () => createXai(settings).languageModel(model))
		.with("groq", () => createGroq(settings).languageModel(model))
		.with("deepseek", () => createDeepSeek(settings).languageModel(model))
		.with("togetherai", () => createTogetherAI(settings).languageModel(model))
		.with("fireworks", () => createFireworks(settings).languageModel(model))
		.with("cerebras", () => createCerebras(settings).languageModel(model))
		.with("perplexity", () => createPerplexity(settings).languageModel(model))
		.with("openai-compatible", () =>
			createOpenAICompatible({ name: "openai-compatible", ...settings }).languageModel(model),
		)
		.with("ollama", () => {
			const ollama = createOllama({
				name: "ollama",
				baseURL,
				...aiTransport(),
				...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
			});

			return ollama.languageModel(model);
		})
		.exhaustive();
}

export function getAgentModel(input: GetModelInput) {
	if (!isDirectOpenAIProvider(input)) return getModel(input);

	// Direct OpenAI assistants use Responses for reasoning with function tools.
	return withReasoning(
		input,
		createOpenAI({ apiKey: input.apiKey, baseURL: resolveAiBaseUrl(input), ...aiTransport() }).responses(input.model),
	);
}

const aiCredentialsSchema = z.object({
	provider: aiProviderSchema,
	model: z.string().trim().min(1),
	apiKey: z.string().trim().min(1),
	baseURL: z.string().optional().default(""),
	reasoning: aiReasoningSchema.nullable().optional(),
	contextTokens: z.number().int().positive().nullable().optional(),
});

export const fileInputSchema = z.object({
	name: z.string(),
	// File bytes only: the AI SDK would download a URL here on the server.
	data: z.base64().max(MAX_AI_FILE_BASE64_CHARS, "File is too large. Maximum size is 10MB."),
});

type TestConnectionInput = z.infer<typeof aiCredentialsSchema>;

type TestConnectionResult = { ok: true } | { ok: false; message: string };

const NETWORK_ERROR_CODES = new Set([
	"ECONNREFUSED",
	"ECONNRESET",
	"EAI_AGAIN",
	"ENOTFOUND",
	"ETIMEDOUT",
	"UND_ERR_CONNECT_TIMEOUT",
	"UND_ERR_SOCKET",
]);

// Provider SDKs wrap the useful error (a socket failure, an abort) inside a generic one, so the
// signal we need is usually a few `cause` hops down rather than on the error we are handed.
function findInCauseChain<T>(error: unknown, pick: (candidate: unknown) => T | undefined): T | undefined {
	let current = error;

	for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth++) {
		const picked = pick(current);
		if (picked !== undefined) return picked;
		current = (current as { cause?: unknown }).cause;
	}

	return undefined;
}

function isTimeout(error: unknown): boolean {
	return (
		findInCauseChain(error, (candidate) =>
			candidate instanceof Error && (candidate.name === "TimeoutError" || candidate.name === "AbortError")
				? true
				: undefined,
		) ?? false
	);
}

function findNetworkErrorCode(error: unknown): string | undefined {
	return findInCauseChain(error, (candidate) => {
		const code = (candidate as { code?: unknown }).code;

		return typeof code === "string" && NETWORK_ERROR_CODES.has(code) ? code : undefined;
	});
}

// The key is never part of a response body, but a provider echoing the request would leak it into
// the message we persist, so scrub it from anything we did not write ourselves. The schema allows
// keys as short as one character, and a mangled message costs less than a leaked credential, so
// every non-empty key is redacted. The guard only keeps `replaceAll` from splicing "***" between
// every character of the message.
function redactApiKey(message: string, apiKey: string): string {
	if (!apiKey) return message;

	return message.replaceAll(apiKey, "***");
}

function describeTestConnectionFailure(input: TestConnectionInput, error: unknown): string {
	const provider = AI_PROVIDER_DISPLAY_NAMES[input.provider];
	const endpoint = input.baseURL.trim() || AI_PROVIDER_DEFAULT_BASE_URLS[input.provider];

	if (isTimeout(error)) {
		return `${provider} did not respond within ${TEST_CONNECTION_TIMEOUT_MS / 1000} seconds. The service may be unreachable, or the model may be too slow to load. Try again, or choose a faster model.`;
	}

	if (findNetworkErrorCode(error)) {
		return endpoint
			? `Could not reach ${endpoint}. Check that the base URL is correct and the service is running.`
			: `${provider} could not be reached. Check that the base URL is correct and the service is running.`;
	}

	if (LoadAPIKeyError.isInstance(error))
		return `${provider} was set up without an API key. Enter an API key and test again.`;
	if (NoSuchModelError.isInstance(error))
		return `${provider} has no model named "${input.model}". Check the model name and test again.`;

	if (APICallError.isInstance(error)) {
		const status = error.statusCode;

		if (status === 401 || status === 403) return `${provider} rejected the API key. Check the key and test again.`;
		if (status === 404)
			return `${provider} has no model named "${input.model}", or the base URL is wrong. Check both and test again.`;
		if (status === 429) return `${provider} rate-limited the test. Wait a moment and try again.`;
		if (status !== undefined && status >= 500) {
			return `${provider} reported a server error (${status}). This is a problem on the provider's side. Try again later.`;
		}

		return `${provider} rejected the test request${status === undefined ? "" : ` (${status})`}: ${redactApiKey(error.message, input.apiKey)}`;
	}

	if (error instanceof Error && error.message) {
		return `${provider} could not be tested: ${redactApiKey(error.message, input.apiKey)}`;
	}

	return `${provider} couldn't be tested and reported no reason. Try again.`;
}

export async function testConnection(input: TestConnectionInput): Promise<TestConnectionResult> {
	const RESPONSE_OK = "1";
	const provider = AI_PROVIDER_DISPLAY_NAMES[input.provider];

	// Resolved outside the try so the base-URL policy error still reaches the router, which turns it
	// into an invalid-configuration response rather than a provider failure.
	const model = getModel(input);

	let result: Awaited<ReturnType<typeof generateText>>;

	try {
		result = await generateText({
			model,
			// Thinking spends tokens before the answer, so a connection set to an effort gets room for it.
			maxOutputTokens:
				input.reasoning && input.reasoning !== "none"
					? TEST_CONNECTION_REASONING_MAX_OUTPUT_TOKENS
					: TEST_CONNECTION_MAX_OUTPUT_TOKENS,
			// A connection test must not silently multiply its own wait by retrying behind the user.
			maxRetries: 0,
			abortSignal: AbortSignal.timeout(TEST_CONNECTION_TIMEOUT_MS),
			messages: [{ role: "user", content: `Respond only with the single character: ${RESPONSE_OK}` }],
		});
	} catch (error) {
		return { ok: false, message: describeTestConnectionFailure(input, error) };
	}

	if (result.text.trim() === RESPONSE_OK) return { ok: true };

	if (result.finishReason === "length") {
		return {
			ok: false,
			message: `${provider} is reachable, but the model returned too much text during the test. Try a model that follows short instructions.`,
		};
	}

	return {
		ok: false,
		message: `${provider} is reachable, but the model replied with unexpected output instead of a simple confirmation. Try another model.`,
	};
}

type ParsePdfInput = z.infer<typeof aiCredentialsSchema> & {
	file: z.infer<typeof fileInputSchema>;
};

type BuildResumeParsingMessagesInput = {
	userPrompt: string;
	file: z.infer<typeof fileInputSchema>;
	mediaType: string;
};

function buildResumeParsingSystemPrompt(systemPrompt: string): string {
	return `${systemPrompt}\n\nIMPORTANT: You must return ONLY raw valid JSON. Do not return markdown, do not return explanations. Just the JSON object. Use the following JSON as a template and fill in the extracted values. For arrays, you MUST use the exact key names shown in the template (e.g. use 'description' instead of 'summary', 'website' instead of 'url'):\n\n${JSON.stringify(aiExtractionTemplate, null, 2)}`;
}

function buildResumeParsingMessages({ userPrompt, file, mediaType }: BuildResumeParsingMessagesInput): ModelMessage[] {
	return [
		{
			role: "user",
			content: [
				{ type: "text", text: userPrompt },
				{ type: "file", data: Buffer.from(file.data, "base64"), mediaType, filename: file.name },
			],
		},
	];
}

function buildResumeParsingTextMessages({ userPrompt, text }: { userPrompt: string; text: string }): ModelMessage[] {
	return [
		{
			role: "user",
			content: [
				{
					type: "text",
					text: `${userPrompt}\n\nThe Microsoft Word file has been converted to plain text below.\n\n${text}`,
				},
			],
		},
	];
}

/** `options` carries the signal and retries; a resume isn't cut at the structured-answer length. */
async function parsePdf(input: ParsePdfInput, options?: ModelCallOptions): Promise<ResumeData> {
	const model = getModel(input);

	const result = await generateText({
		model,
		// The user's time limit comes in the signal; the server-wide AI_REQUEST_TIMEOUT_MS only covers a call without one.
		...sdkCallSettings({ ...options, signal: options?.signal ?? aiDeadline(), maxOutputTokens: null }),
		system: buildResumeParsingSystemPrompt(pdfParserSystemPrompt),
		messages: buildResumeParsingMessages({
			userPrompt: pdfParserUserPrompt,
			file: input.file,
			mediaType: "application/pdf",
		}),
	}).catch((error: unknown) => logAndRethrow("Failed to generate the text with the model", error));

	return parseAndValidateResumeJson(result.text);
}

type ParseDocxInput = z.infer<typeof aiCredentialsSchema> & {
	file: z.infer<typeof fileInputSchema>;
	mediaType: "application/msword" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
};

function readDocumentXml(data: string): string {
	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipEntries(
			Buffer.from(data, "base64"),
			(name) => name === DOCX_DOCUMENT_XML_PATH,
			MAX_DOCX_DOCUMENT_XML_BYTES,
		);
	} catch (error) {
		if (error instanceof ZipEntryTooLargeError) throw new Error("DOCX document content is too large.");
		throw new Error("Invalid DOCX archive.");
	}
	const xml = entries[DOCX_DOCUMENT_XML_PATH];
	if (!xml) throw new Error("DOCX document content not found.");
	return new TextDecoder().decode(xml);
}

function extractDocxText(file: z.infer<typeof fileInputSchema>): string {
	const documentXml = readDocumentXml(file.data);
	// ponytail: minimal OOXML body-text extraction; add a DOCX parser dependency if tracked changes matter.
	const text = decodeEntities(
		// `[^<>]` keeps each match from scanning past the next tag, so malformed markup costs linear time.
		documentXml
			.replace(/<w:tab\b[^<>]*\/>/g, "\t")
			.replace(/<w:br\b[^<>]*\/>/g, "\n")
			.replace(/<\/w:p>/g, "\n")
			.replace(/<[^<>]*>/g, ""),
	)
		.replace(/\r/g, "")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	if (!text) throw new Error("DOCX document content is empty.");
	return text;
}

async function parseDocx(input: ParseDocxInput, options?: ModelCallOptions): Promise<ResumeData> {
	const model = getModel(input);
	const messages =
		input.mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
			? buildResumeParsingTextMessages({ userPrompt: docxParserUserPrompt, text: extractDocxText(input.file) })
			: buildResumeParsingMessages({
					userPrompt: docxParserUserPrompt,
					file: input.file,
					mediaType: input.mediaType,
				});

	const result = await generateText({
		model,
		...sdkCallSettings({ ...options, signal: options?.signal ?? aiDeadline(), maxOutputTokens: null }),
		system: buildResumeParsingSystemPrompt(docxParserSystemPrompt),
		messages,
	}).catch((error: unknown) => logAndRethrow("Failed to generate the text with the model", error));

	return parseAndValidateResumeJson(result.text);
}

export const aiService = {
	parseDocx,
	parsePdf,
	testConnection,
};
