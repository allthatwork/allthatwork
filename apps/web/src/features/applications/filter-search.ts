import type { ApplicationFilters, ApplicationSort } from "@reactive-resume/schema/applications/filters";
import z from "zod";
import {
	applicationFiltersSchema,
	applicationSortSchema,
	DEFAULT_APPLICATION_FILTERS,
	DEFAULT_APPLICATION_SORT,
	OPEN_STAGES,
} from "@reactive-resume/schema/applications/filters";
import { sameFilters } from "./filter";

// The router reads each search value as JSON when it can, so `fit=85` arrives as a number and `tag=2024` too. The
// params take what comes and the filters schema decides what's valid; anything it rejects falls back to the default.
const scalar = z.union([z.string(), z.number(), z.boolean()]);
const scalarParam = scalar.optional().catch(undefined);
const listParam = z
	.union([scalar, z.array(scalar)])
	.optional()
	.catch(undefined);

/** The filter and sort params of the Applications address, spread into the route's search schema. */
export const filterSearchShape = {
	q: scalarParam,
	stage: listParam,
	build: listParam,
	foundBy: listParam,
	lane: listParam,
	laneMode: scalarParam,
	fit: scalarParam,
	tfit: scalarParam,
	source: listParam,
	resume: scalarParam,
	letter: scalarParam,
	attention: listParam,
	added: scalarParam,
	updated: scalarParam,
	tag: listParam,
	notTag: listParam,
	tagMode: scalarParam,
	sort: scalarParam,
	dir: scalarParam,
	/** Old links' Show closed: adds Closed to the stages. */
	closed: z.boolean().optional().catch(undefined),
};

const filterSearchSchema = z.object(filterSearchShape);
export type FilterSearch = z.output<typeof filterSearchSchema>;
type Scalar = z.output<typeof scalar>;

export const FILTER_SEARCH_KEYS = Object.keys(filterSearchShape) as (keyof FilterSearch)[];

/** The params a tab remembers: the filters without the sort, which the account keeps instead. */
export const REMEMBERED_SEARCH_KEYS = FILTER_SEARCH_KEYS.filter((key) => key !== "sort" && key !== "dir");

const ARRAY_KEYS = new Set(["stage", "build", "foundBy", "lane", "source", "attention", "tag", "notTag"]);
const NUMBER_KEYS = new Set(["fit", "tfit", "added", "updated"]);

/** Whether the address holds any filter param (the sort, view, create and applicationId don't count). */
export const hasFilterParams = (search: Partial<Record<string, unknown>>) =>
	REMEMBERED_SEARCH_KEYS.some((key) => search[key] !== undefined);

const asList = (value: Scalar | Scalar[] | undefined) =>
	value === undefined ? undefined : (Array.isArray(value) ? value : [value]).map(String);

/** Reads the filters and sort from the address; a value that isn't valid falls back to its default. */
export function filtersFromSearch(search: FilterSearch): { filters: ApplicationFilters; sort: ApplicationSort } {
	const shape = applicationFiltersSchema.shape;
	const filters = { ...DEFAULT_APPLICATION_FILTERS, stage: [...DEFAULT_APPLICATION_FILTERS.stage] };
	for (const key of Object.keys(shape) as (keyof ApplicationFilters)[]) {
		const raw = search[key];
		if (raw === undefined) continue;
		const value = ARRAY_KEYS.has(key) ? asList(raw) : String(raw as Scalar);
		const parsed = shape[key].safeParse(value);
		if (parsed.success) Object.assign(filters, { [key]: parsed.data });
	}
	if (search.closed && !filters.stage.includes("closed")) {
		filters.stage = search.stage === undefined ? [...OPEN_STAGES, "closed"] : [...filters.stage, "closed"];
	}

	return { filters, sort: sortFromSearch(search) ?? DEFAULT_APPLICATION_SORT };
}

/**
 * The sort in the address, or null when it has none, so the account's sort applies. Each half left out is at its
 * default (Updated, descending), as the address has always written it; a value that isn't valid counts as none.
 */
export function sortFromSearch(search: Pick<FilterSearch, "sort" | "dir">): ApplicationSort | null {
	if (search.sort === undefined && search.dir === undefined) return null;
	const sort = applicationSortSchema.safeParse({
		sort: search.sort === undefined ? undefined : String(search.sort),
		dir: search.dir === undefined ? undefined : String(search.dir),
	});
	return sort.success ? sort.data : null;
}

/**
 * The address params for these filters and sort: every key present, undefined at its default so the router leaves it
 * out. One value reads as `stage=saved`, several as a list; the fit and date presets go as numbers (`fit=85`).
 */
export function searchFromFilters(filters: ApplicationFilters, sort: ApplicationSort): FilterSearch {
	const search: Record<string, Scalar | Scalar[] | undefined> = {};
	for (const key of FILTER_SEARCH_KEYS) search[key] = undefined;
	const defaults = DEFAULT_APPLICATION_FILTERS;

	for (const key of Object.keys(defaults) as (keyof ApplicationFilters)[]) {
		const value = filters[key];
		const single = { ...defaults, [key]: value } as ApplicationFilters;
		if (sameFilters(single, defaults)) continue;
		if (Array.isArray(value)) search[key] = value.length === 1 ? value[0] : [...value];
		else if (key === "q") search[key] = value.trim();
		else search[key] = NUMBER_KEYS.has(key) && /^\d+$/.test(value) ? Number(value) : value;
	}
	// The default sort stays out of the address; with no sort there, the account's applies.
	if (sort.sort !== DEFAULT_APPLICATION_SORT.sort) search.sort = sort.sort;
	if (sort.dir !== DEFAULT_APPLICATION_SORT.dir) search.dir = sort.dir;
	return search as FilterSearch;
}
