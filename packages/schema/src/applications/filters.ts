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
export const SEARCH_FIT_FILTER_VALUES = ["any", "80", "85", "90", "95", "none"] as const;
export const TARGETING_FIT_FILTER_VALUES = ["any", "60", "70", "80", "none"] as const;
export const DOCUMENT_FILTER_VALUES = ["any", "linked", "none"] as const;
export const ATTENTION_FILTER_VALUES = ["no-reply", "follow-up", "interview", "questions"] as const;
export const DATE_FILTER_VALUES = ["any", "7", "14", "30"] as const;
/** The sort choices, in the order the Sort menu lists them. */
export const APPLICATION_SORT_KEYS = ["updated", "added", "applied", "next", "fit", "tfit", "role", "company"] as const;
export type ApplicationSortKey = (typeof APPLICATION_SORT_KEYS)[number];
export type ApplicationSortDirection = "asc" | "desc";

/** The value that stands for "not set" in Found by, Found on and Lane. */
export const NOT_SET = "none";

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
	/** Search fit at least this, or `none` for no search fit yet. */
	fit: z.enum(SEARCH_FIT_FILTER_VALUES).default("any"),
	/** Targeting fit at least this, or `none` for no targeting fit yet. */
	tfit: z.enum(TARGETING_FIT_FILTER_VALUES).default("any"),
	/** Found on. */
	source: z.array(z.string()).default(() => []),
	resume: z.enum(DOCUMENT_FILTER_VALUES).default("any"),
	letter: z.enum(DOCUMENT_FILTER_VALUES).default("any"),
	attention: z.array(z.enum(ATTENTION_FILTER_VALUES)).default(() => []),
	/** Added within this many days. */
	added: z.enum(DATE_FILTER_VALUES).default("any"),
	/** Updated within this many days. */
	updated: z.enum(DATE_FILTER_VALUES).default("any"),
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
