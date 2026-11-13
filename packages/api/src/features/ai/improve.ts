import type { ModelCallOptions } from "./request-limits";
import { z } from "zod";
import { improveSystemPrompt, improveUserPromptTemplate } from "@reactive-resume/ai/prompts";
import { generateJson } from "./generate-json";
import { getModel } from "./service";

const REQUESTS = {
	verb: "Stronger verb",
	result: "Add a result",
	shorter: "Make it shorter",
} as const;

/** The most of a line Improve rewrites, and the most of the field around it the model reads. */
export const IMPROVE_LINE_CHARS = 10_000;
export const IMPROVE_CONTEXT_CHARS = 10_000;

export const improveInputSchema = z.object({
	aiProviderId: z.string().optional(),
	line: z.string().trim().min(1).max(IMPROVE_LINE_CHARS),
	action: z.enum(["verb", "result", "shorter", "custom"]),
	/** The user's own words, for "Ask for something else…". */
	request: z.string().trim().max(500).optional(),
	/** Where the line sits, e.g. "Description · Fieldnote". */
	where: z.string().trim().max(200).default(""),
	/** The whole field, so a result can come from the lines around it. Cut around the line before the model reads it. */
	context: z.string().max(200_000).default(""),
});

type ImproveInput = z.infer<typeof improveInputSchema>;

export const improveOutputSchema = z.object({
	text: z
		.string()
		.transform((text) => text.replace(/\s+/g, " ").trim())
		.pipe(z.string().min(1)),
	why: z.string().catch(""),
	addsFacts: z.boolean().catch(true),
});

export type ImproveOutput = z.infer<typeof improveOutputSchema>;

type ImproveServiceInput = ImproveInput & {
	provider: Parameters<typeof getModel>[0]["provider"];
	model: string;
	apiKey: string;
	baseURL: string;
	reasoning?: Parameters<typeof getModel>[0]["reasoning"];
	contextTokens?: Parameters<typeof getModel>[0]["contextTokens"];
};

/**
 * At most `max` characters of the field around the line: the line in the middle, whole lines around it where the cut
 * allows. A line the field doesn't contain (edited meanwhile) gets the start of the field.
 */
export function contextAround(context: string, line: string, max = IMPROVE_CONTEXT_CHARS): string {
	if (context.length <= max) return context;
	const at = Math.max(0, context.indexOf(line));
	const length = Math.min(line.length, max);
	const start = Math.min(Math.max(0, at - Math.floor((max - length) / 2)), context.length - max);
	let from = start;
	let to = start + max;
	// Drop the part lines at the edges, but never into the line itself.
	if (from > 0) {
		const newline = context.indexOf("\n", from);
		if (newline !== -1 && newline < at) from = newline + 1;
	}
	if (to < context.length) {
		const newline = context.lastIndexOf("\n", to - 1);
		if (newline >= at + length) to = newline;
	}
	return context.slice(from, to);
}

function buildUserPrompt(input: ImproveInput): string {
	const request =
		input.action === "custom" ? `Something else: ${input.request || "Improve it."}` : REQUESTS[input.action];
	const values: Record<string, string> = {
		REQUEST: request,
		WHERE: input.where || "Not given",
		LINE: input.line,
		CONTEXT: contextAround(input.context, input.line) || "None",
	};

	// One pass, so text in the line that looks like a placeholder stays as it is.
	return improveUserPromptTemplate.replace(
		/\{\{([A-Z_]+)\}\}/g,
		(placeholder, name: string) => values[name] ?? placeholder,
	);
}

/** One suggested rewrite of one line. Nothing is written: the user replaces the line or keeps theirs. */
export function improveLine(input: ImproveServiceInput, options?: ModelCallOptions): Promise<ImproveOutput> {
	return generateJson(
		getModel(input),
		{ system: improveSystemPrompt, prompt: buildUserPrompt(input) },
		improveOutputSchema,
		options,
	);
}
