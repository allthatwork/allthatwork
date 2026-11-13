import type { ModelCallOptions } from "./request-limits";
import type { LanguageModel } from "ai";
import type { z } from "zod";
import { ORPCError } from "@orpc/client";
import { generateText } from "ai";
import { safetySystemPrompt } from "@reactive-resume/ai/prompts";
import { sdkCallSettings } from "./request-limits";

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
		...sdkCallSettings(options),
		system: `${safetySystemPrompt}\n\n${system ?? ""}`,
		messages: [{ role: "user", content: prompt }],
	});

	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
	const candidate = fenced?.[1] ?? text;

	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start === -1 || end === -1 || end < start) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "The AI response could not be parsed." });
	}

	return schema.parse(JSON.parse(candidate.slice(start, end + 1)));
}
