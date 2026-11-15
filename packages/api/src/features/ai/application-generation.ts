import type { ModelCallOptions } from "./request-limits";
import type z from "zod";
import { ORPCError } from "@orpc/client";
import { APICallError, generateText, RetryError } from "ai";
import { safetySystemPrompt } from "@reactive-resume/ai/prompts";
import { aiDeadline, generateJson as sharedGenerateJson } from "./generate-json";
import { sdkCallSettings } from "./request-limits";

// --- AI provider failure translation ------------------------------------------
// The AI SDK surfaces provider-side failures as `APICallError` (HTTP 4xx/5xx from
// the provider) or `RetryError` with `reason: "maxRetriesExceeded"`.  Translating
// only those to BAD_GATEWAY gives the client an actionable status code instead of
// an opaque 500.  Validation, credential, model-resolution, and response-parsing
// errors rethrow unchanged.

function isAiProviderGatewayError(error: unknown): boolean {
	if (APICallError.isInstance(error)) return true;
	if (RetryError.isInstance(error) && error.reason === "maxRetriesExceeded") return true;
	return false;
}

/** Throws a BAD_GATEWAY ORPCError, preserving the original cause for upstream error reporters. */
function throwAiProviderGatewayError(cause?: unknown): never {
	throw new ORPCError("BAD_GATEWAY", {
		message: "Couldn't reach the AI provider. Check its settings and try again.",
		cause,
	});
}

/**
 * Wrapper around the shared `generateJson` that translates AI provider failures
 * to BAD_GATEWAY.  Accepts the same prompt shape as the shared module; `options` carries the signal and the user's
 * retries and answer length (Settings → AI limits).
 * Exported for tests.
 */
export async function generateJson<T>(
	model: Parameters<typeof sharedGenerateJson>[0],
	prompt: { system?: string; prompt: string },
	schema: z.ZodType<T>,
	options?: ModelCallOptions,
) {
	try {
		return await sharedGenerateJson(model, prompt, schema, options);
	} catch (error) {
		if (isAiProviderGatewayError(error)) throwAiProviderGatewayError(error);
		throw error;
	}
}

/**
 * Exported for tests: provider-failure translation shared by every copilot procedure. `options` carries the user's
 * time limit and retries (Settings → AI limits); the server-wide deadline only covers a call without a signal.
 */
export async function generatePlainText(
	model: Parameters<typeof sharedGenerateJson>[0],
	prompt: string,
	options?: ModelCallOptions,
) {
	try {
		const { text } = await generateText({
			model,
			// A letter or a message isn't a structured answer, so the JSON answer length doesn't apply.
			...sdkCallSettings({ ...options, signal: options?.signal ?? aiDeadline(), maxOutputTokens: null }),
			system: safetySystemPrompt,
			messages: [{ role: "user", content: prompt }],
		});
		return text.trim();
	} catch (error) {
		if (isAiProviderGatewayError(error)) throwAiProviderGatewayError(error);
		throw error;
	}
}
