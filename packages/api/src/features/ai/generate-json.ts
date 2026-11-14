import type { ModelCallOptions } from "./request-limits";
import type { LanguageModel } from "ai";
import { ORPCError } from "@orpc/client";
import { generateText } from "ai";
import { z } from "zod";
import { safetySystemPrompt } from "@reactive-resume/ai/prompts";
import { sdkCallSettings } from "./request-limits";

// A provider that stops responding can't hold a standalone request open forever. Streamed chats have their own budgets.
// Self-hosted local models that need longer (a CPU model reading a long PDF) can raise AI_REQUEST_TIMEOUT_MS.
// In this fork the user's "Time limit for other AI requests" governs every call that comes with a signal (through
// withRequestLimits); this server-wide timeout only covers a call that comes without one.
const AI_REQUEST_TIMEOUT_MS = z.coerce
	.number()
	.int()
	.positive()
	.max(2_147_483_647)
	.catch(300_000)
	.parse(process.env.AI_REQUEST_TIMEOUT_MS?.trim() || undefined);

export function aiDeadline(signal?: AbortSignal) {
	const timeout = AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export type GenerateJsonPrompt = {
	system?: string;
	prompt: string;
};

/**
 * `generateText` plus tolerant JSON extraction and Zod validation.
 *
 * The SDK's `generateObject` is not wired for every provider this app supports, and several
 * providers wrap JSON in prose or a code fence whatever the prompt says, so the response is parsed
 * defensively: strip a fence if there is one, take the outermost braces, then validate. `options` carries the
 * signal and the user's retries and answer length (Settings → AI limits → All AI requests).
 */
export async function generateJson<T>(
	model: LanguageModel,
	{ system, prompt }: GenerateJsonPrompt,
	schema: z.ZodType<T>,
	options?: ModelCallOptions,
): Promise<T> {
	const { text } = await generateText({
		model,
		// The user's time limit comes in the signal; the server-wide AI_REQUEST_TIMEOUT_MS only covers a call without one.
		...sdkCallSettings({ ...options, signal: options?.signal ?? aiDeadline() }),
		system: `${safetySystemPrompt}\n\n${system ?? ""}`,
		messages: [{ role: "user", content: prompt }],
	});

	const fenceStart = text.indexOf("```");
	const fenceEnd = fenceStart === -1 ? -1 : text.indexOf("```", fenceStart + 3);
	const candidate = fenceEnd === -1 ? text : text.slice(fenceStart + 3, fenceEnd);

	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start === -1 || end === -1 || end < start) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "The AI response couldn't be read. Try again, or choose another model.",
		});
	}

	return schema.parse(JSON.parse(candidate.slice(start, end + 1)));
}
