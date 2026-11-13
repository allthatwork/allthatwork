import z from "zod";

type Def = {
	type: string;
	checks?: {
		_zod: {
			def: { check: string; maximum?: number; minimum?: number; value?: unknown; inclusive?: boolean; format?: string };
		};
	}[];
	shape?: Record<string, z.ZodType>;
	element?: z.ZodType;
	innerType?: z.ZodType;
	options?: z.ZodType[];
	in?: z.ZodType;
};

const defOf = (schema: z.ZodType) => (schema as unknown as { _zod: { def: Def } })._zod.def;

/** Strings capped at this many characters or more are cut at a word; shorter caps are labels, cut exactly. */
const WORD_CUT_FROM = 200;

/** `text` cut to `max` characters: at the last space when the cap is long enough for that to read well. */
export function cutText(text: string, max: number) {
	if (text.length <= max) return text;
	const trimmed = text.trim();
	if (trimmed.length <= max) return trimmed;
	// Never half of a character pair: a lone surrogate can't be stored as JSON.
	const code = trimmed.charCodeAt(max - 1);
	const hard = trimmed.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
	if (max < WORD_CUT_FROM) return hard.trimEnd();
	// The character just past the cap tells whether the cut already falls between words.
	if (/\s/.test(trimmed.charAt(hard.length))) return hard.trimEnd();
	const space = hard.search(/\s\S*$/);
	// One very long "word" (a URL, an unbroken string) is cut where it is rather than losing most of the text.
	return (space > max / 2 ? hard.slice(0, space) : hard).trimEnd();
}

/** The checks of one type, by name: `max_length`, `less_than` and so on. */
const check = (def: Def, name: string) => def.checks?.find((entry) => entry._zod.def.check === name)?._zod.def;

/** `value` brought within what `schema` allows wherever only a size or a range is wrong; anything else is left as is. */
function fit(schema: z.ZodType, value: unknown): unknown {
	const def = defOf(schema);
	switch (def.type) {
		case "optional":
		case "nullable":
		case "default":
		case "prefault":
		case "catch":
		case "readonly":
		case "nonoptional":
			return value === undefined || value === null || !def.innerType ? value : fit(def.innerType, value);
		case "pipe":
			return def.in ? fit(def.in, value) : value;
		case "string": {
			const max = check(def, "max_length")?.maximum;
			return typeof value === "string" && max !== undefined ? cutText(value, max) : value;
		}
		case "number": {
			if (typeof value !== "number" || !Number.isFinite(value)) return value;
			let result = check(def, "number_format")?.format?.includes("int") ? Math.round(value) : value;
			const low = check(def, "greater_than");
			const high = check(def, "less_than");
			if (low?.inclusive && typeof low.value === "number") result = Math.max(result, low.value);
			if (high?.inclusive && typeof high.value === "number") result = Math.min(result, high.value);
			return result;
		}
		case "array": {
			if (!Array.isArray(value)) return value;
			const max = check(def, "max_length")?.maximum;
			const items = max === undefined ? value : value.slice(0, max);
			return def.element ? items.map((item) => fit(def.element as z.ZodType, item)) : items;
		}
		case "object": {
			if (!value || typeof value !== "object" || Array.isArray(value) || !def.shape) return value;
			const result: Record<string, unknown> = { ...value };
			for (const [key, field] of Object.entries(def.shape)) if (key in result) result[key] = fit(field, result[key]);
			return result;
		}
		case "union": {
			// The first option the fitted value satisfies; for a tagged union only the option with the right tag can.
			for (const option of def.options ?? []) {
				const fitted = fit(option, value);
				if (option.safeParse(fitted).success) return fitted;
			}
			return value;
		}
		default:
			return value;
	}
}

/**
 * A parser for what a model returned, trimmed to `schema` instead of failing on one item or one word too many: arrays
 * keep their first `max` items, strings are cut at `max` (at a word from 200 characters), and numbers are rounded to
 * whole numbers where they must be and clamped to their range. Wrong types and missing fields still fail. The schema
 * itself stays strict, for the prompt's JSON schema and for stored data.
 */
export function tolerant<T extends z.ZodType>(schema: T) {
	return z.preprocess((value) => fit(schema, value), schema);
}
