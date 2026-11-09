import z from "zod";
import { applicationStatusSchema } from "./data";

/**
 * The filters on the Applications screen, as data only (no ids), so saved views can store them as they are. Within one
 * filter the values are "any of these"; filters combine with AND. Arrays default to empty, single choices to "any";
 * Stage defaults to the five open stages and is never empty.
 */

export const OPEN_STAGES = ["saved", "applied", "screening", "interview", "offer"] as const;

/** `none` is an application that isn't queued (`targetingBuildStatus` null). */
export const BUILD_FILTER_VALUES = ["none", "build", "building", "built", "failed"] as const;
export const DOCUMENT_FILTER_VALUES = ["any", "linked", "none"] as const;
export const ATTENTION_FILTER_VALUES = ["no-reply", "follow-up", "interview", "questions"] as const;
/** The highest fit a filter can ask for, and the most days the date filters reach back. */
export const FIT_FILTER_MAX = 100;
export const DAYS_FILTER_MAX = 365;
/** The sort choices, in the order the Sort menu lists them. */
export const APPLICATION_SORT_KEYS = ["updated", "added", "applied", "next", "fit", "tfit", "role", "company"] as const;
export type ApplicationSortKey = (typeof APPLICATION_SORT_KEYS)[number];
export type ApplicationSortDirection = "asc" | "desc";

/** The value that stands for "not set" in Found by, Found on and Lane. */
export const NOT_SET = "none";

/** A whole number from the text, or null when it isn't one ("75", " 075 " and 75 are; "7.5", "-3" and "abc" aren't). */
const wholeNumber = (value: string | number): number | null => {
	const text = String(value).trim();
	return /^\d+$/.test(text) ? Number(text) : null;
};

/**
 * A fit filter's value: "any" or a whole number 0 to 100 as text, meaning that fit and up. Never fails: more than 100
 * reads as 100, and anything else that isn't a whole number reads as "any" (so does "none", which older links and saved
 * views can hold from when the filter could ask for no fit yet).
 */
export function normalizeFitFilter(value: string | number): string {
	const number = wholeNumber(value);
	return number === null ? "any" : String(Math.min(number, FIT_FILTER_MAX));
}

/** The longest reviewer slot a review can have (`targetingReviewSchema`). */
const REVIEWER_SLOT_MAX = 40;

/**
 * The reviewer fit filters, each "slot:fit" ("B:80": reviewer B's fit in the latest review round, 80 and up). Never
 * fails: entries without a slot or a fit are dropped, fits are read like the other fit filters, a reviewer set twice
 * keeps the last, and the result is sorted by slot.
 */
export function normalizeReviewerFits(values: readonly string[]): string[] {
	const bySlot = new Map<string, string>();
	for (const value of values) {
		const at = value.lastIndexOf(":");
		if (at <= 0) continue;
		const slot = value.slice(0, at).trim();
		const fit = normalizeFitFilter(value.slice(at + 1));
		if (!slot || slot.length > REVIEWER_SLOT_MAX || fit === "any") continue;
		bySlot.set(slot.toLocaleLowerCase(), `${slot}:${fit}`);
	}
	return [...bySlot.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * A date filter's value: "any" or a whole number of days 1 to 365 as text. Never fails: more than 365 reads as 365,
 * and 0 or anything that isn't a whole number reads as "any".
 */
export function normalizeDaysFilter(value: string | number): string {
	const number = wholeNumber(value);
	return number === null || number === 0 ? "any" : String(Math.min(number, DAYS_FILTER_MAX));
}

// Old links and stored views hold the same text ("85", "14"), so they read as before. The router hands numbers over as
// numbers, so those are taken too.
const fitFilterSchema = z
	.union([z.string(), z.number()])
	.transform(normalizeFitFilter)
	.pipe(z.string())
	.default("any")
	.describe('"any" or a whole number 0 to 100: that fit and up. More than 100 reads as 100.');
const reviewerFitsSchema = z
	.array(z.union([z.string(), z.number()]).transform(String))
	.transform(normalizeReviewerFits)
	.pipe(z.array(z.string()))
	.default(() => [])
	.describe('Each reviewer\'s fit in the latest review round, as "slot:fit" ("B:80": reviewer B, 80 and up).');
const daysFilterSchema = z
	.union([z.string(), z.number()])
	.transform(normalizeDaysFilter)
	.pipe(z.string())
	.default("any")
	.describe('"any" or a whole number of days 1 to 365. More than 365 reads as 365; 0 reads as "any".');

export const applicationFiltersSchema = z.object({
	/** Role, company, location, contact names and tags, as one substring. */
	q: z.string().default(""),
	stage: z
		.array(applicationStatusSchema)
		.min(1)
		.default(() => [...OPEN_STAGES]),
	build: z.array(z.enum(BUILD_FILTER_VALUES)).default(() => []),
	foundBy: z.array(z.string()).default(() => []),
	lane: z.array(z.string()).default(() => []),
	/** Match either lane, or the primary lane only. */
	laneMode: z.enum(["either", "primary"]).default("either"),
	/** Search fit at least this (0 to 100). */
	fit: fitFilterSchema,
	/** Targeting fit (the reviewers' median) at least this (0 to 100). */
	tfit: fitFilterSchema,
	/** Single reviewers' fits in the latest review round, "slot:fit" each. */
	rfit: reviewerFitsSchema,
	/** Found on. */
	source: z.array(z.string()).default(() => []),
	resume: z.enum(DOCUMENT_FILTER_VALUES).default("any"),
	letter: z.enum(DOCUMENT_FILTER_VALUES).default("any"),
	attention: z.array(z.enum(ATTENTION_FILTER_VALUES)).default(() => []),
	/** Added within this many days (1 to 365). */
	added: daysFilterSchema,
	/** Updated within this many days (1 to 365). */
	updated: daysFilterSchema,
	/** Tags the application must have (any or all of them, by `tagMode`). */
	tag: z.array(z.string()).default(() => []),
	/** Tags it must not have; these win over `tag`. */
	notTag: z.array(z.string()).default(() => []),
	tagMode: z.enum(["any", "all"]).default("any"),
});

export type ApplicationFilters = z.output<typeof applicationFiltersSchema>;

export const DEFAULT_APPLICATION_FILTERS: ApplicationFilters = applicationFiltersSchema.parse({});

/** The sort of the Board's columns and the List's groups, kept in the address next to the filters. */
export const applicationSortSchema = z.object({
	sort: z.enum(APPLICATION_SORT_KEYS).default("updated"),
	dir: z.enum(["asc", "desc"]).default("desc"),
});

export type ApplicationSort = z.output<typeof applicationSortSchema>;

export const DEFAULT_APPLICATION_SORT: ApplicationSort = applicationSortSchema.parse({});

/** The direction a sort starts in: dates and fits newest or highest first, Next step soonest first, text A to Z. */
export const defaultSortDirection = (key: ApplicationSortKey): ApplicationSortDirection =>
	key === "next" || key === "role" || key === "company" ? "asc" : "desc";
