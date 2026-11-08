import z from "zod";
import { applicationFiltersSchema, applicationSortSchema, DEFAULT_APPLICATION_SORT } from "./filters";
import { DEFAULT_LIST_COLUMNS, LIST_COLUMN_IDS } from "./layout";

/**
 * Saved views on the Applications screen: a name for a set of filters, a sort and the List columns, stored per account.
 * Filters are kept by value only (no ids) and without the search text. Column widths stay the account's, so a view
 * keeps which columns show and their order, not how wide they are.
 */

export const APPLICATION_VIEW_NAME_MAX = 60;
export const APPLICATION_VIEWS_MAX = 50;

export const applicationViewNameSchema = z.string().trim().min(1).max(APPLICATION_VIEW_NAME_MAX);

/** The filters a view keeps: everything but the search text. */
export const applicationViewFiltersSchema = applicationFiltersSchema.omit({ q: true });
export type ApplicationViewFilters = z.output<typeof applicationViewFiltersSchema>;

export const DEFAULT_APPLICATION_VIEW_FILTERS: ApplicationViewFilters = applicationViewFiltersSchema.parse({});

const listColumnIdsSchema = z
	.array(z.enum(LIST_COLUMN_IDS))
	.max(LIST_COLUMN_IDS.length)
	.refine((ids) => new Set(ids).size === ids.length, { message: "Each column can show once." });

/** The sort and the List columns after Role, in order. */
export const applicationViewLayoutSchema = z.object({
	sort: applicationSortSchema,
	listColumns: listColumnIdsSchema,
});
export type ApplicationViewLayout = z.output<typeof applicationViewLayoutSchema>;

export const DEFAULT_APPLICATION_VIEW_LAYOUT: ApplicationViewLayout = {
	sort: DEFAULT_APPLICATION_SORT,
	listColumns: [...DEFAULT_LIST_COLUMNS],
};

/** A stored view as the API returns it. The name is checked on the way in, so reading never rejects one. */
export const applicationViewSchema = z.object({
	id: z.string(),
	name: z.string(),
	filters: applicationViewFiltersSchema,
	layout: applicationViewLayoutSchema,
	/** The view a new tab opens with; at most one per account. */
	isDefault: z.boolean(),
	/** Where it sits in the Views menu, from 0. */
	position: z.number().int(),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
});
export type ApplicationView = z.output<typeof applicationViewSchema>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads stored view filters leniently, field by field: a value that no longer parses (a filter that changed shape, a
 * retired option) falls back to that filter's default, and a list keeps the values that are still valid. Unknown keys
 * are dropped, so a saved view never breaks when the filters change.
 */
export function readApplicationViewFilters(value: unknown): ApplicationViewFilters {
	const filters: ApplicationViewFilters = {
		...DEFAULT_APPLICATION_VIEW_FILTERS,
		stage: [...DEFAULT_APPLICATION_VIEW_FILTERS.stage],
	};
	if (!isRecord(value)) return filters;
	const shape = applicationViewFiltersSchema.shape;
	for (const key of Object.keys(shape) as (keyof ApplicationViewFilters)[]) {
		const raw = value[key];
		if (raw === undefined) continue;
		const field = shape[key];
		const parsed = field.safeParse(raw);
		if (parsed.success) {
			Object.assign(filters, { [key]: parsed.data });
			continue;
		}
		if (!Array.isArray(raw)) continue;
		// Keep the list's valid values; each is checked on its own, so one bad value doesn't drop the rest.
		const kept = raw.filter((item) => field.safeParse([item]).success);
		const list = field.safeParse(kept);
		if (kept.length > 0 && list.success) Object.assign(filters, { [key]: list.data });
	}
	return filters;
}

/** Reads a stored view layout leniently: an unreadable sort is the default, unknown or repeated columns are dropped. */
export function readApplicationViewLayout(value: unknown): ApplicationViewLayout {
	const raw = isRecord(value) ? value : {};
	const sort = applicationSortSchema.safeParse(raw.sort);
	const listColumns = Array.isArray(raw.listColumns)
		? [
				...new Set(
					raw.listColumns.filter((id): id is (typeof LIST_COLUMN_IDS)[number] =>
						(LIST_COLUMN_IDS as readonly unknown[]).includes(id),
					),
				),
			]
		: [...DEFAULT_LIST_COLUMNS];
	return { sort: sort.success && isRecord(raw.sort) ? sort.data : { ...DEFAULT_APPLICATION_SORT }, listColumns };
}
