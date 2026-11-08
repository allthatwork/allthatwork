import type { FilterSearch } from "./filter-search";
import type { ApplicationFilters, ApplicationSort } from "@reactive-resume/schema/applications/filters";
import type { ListColumnId } from "@reactive-resume/schema/applications/layout";
import type { ApplicationView, ApplicationViewFilters } from "@reactive-resume/schema/applications/views";
import { sameFilters } from "./filter";
import { filtersFromSearch, hasFilterParams } from "./filter-search";

/**
 * The rules behind saved views, as pure functions: whether the screen differs from the view that's on, what opening
 * Applications applies, and whether the title row has room for the tabs' labels.
 */

/** A view's filters as the screen's, with no search text. */
export const filtersOfView = (view: Pick<ApplicationView, "filters">): ApplicationFilters => ({
	...view.filters,
	stage: [...view.filters.stage],
	q: "",
});

/** The screen's filters as a view keeps them: everything but the search text. */
export function viewFiltersOf(filters: ApplicationFilters): ApplicationViewFilters {
	const { q: _q, ...rest } = filters;
	return rest;
}

export type ScreenState = {
	filters: ApplicationFilters;
	sort: ApplicationSort;
	/** The List columns after Role, in order. */
	columns: readonly ListColumnId[];
};

const sameColumns = (a: readonly ListColumnId[], b: readonly ListColumnId[]) =>
	a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * Whether the screen differs from the view: its filters (the search text doesn't count), its sort, or its columns
 * (which ones and their order; widths are the account's).
 */
export function isViewEdited(view: Pick<ApplicationView, "filters" | "layout">, screen: ScreenState): boolean {
	return (
		!sameFilters({ ...screen.filters, q: "" }, filtersOfView(view)) ||
		screen.sort.sort !== view.layout.sort.sort ||
		screen.sort.dir !== view.layout.sort.dir ||
		!sameColumns(screen.columns, view.layout.listColumns)
	);
}

/** What a tab keeps between visits: its filters (and, with a view on, its sort), the view and its unsaved columns. */
export type TabState = {
	search: FilterSearch;
	viewId: string | null;
	/** The view's List columns as changed on screen; null while they're the view's own. */
	viewColumns: ListColumnId[] | null;
};

export type Opening =
	/** Keep the address as it is, with no view on (a link with filters). */
	| { kind: "address" }
	/** Bring back this tab's last state. */
	| { kind: "restore"; tab: TabState }
	/** A new tab: the account's default view. */
	| { kind: "view"; view: ApplicationView }
	/** A new tab with no default view: All applications. */
	| { kind: "all" }
	/** A new tab, and the views haven't loaded yet. */
	| { kind: "wait" };

type OpeningInput = {
	/** The address's search params now. */
	address: FilterSearch;
	/** What this tab kept, or null for a new tab. */
	stored: TabState | null;
	/** The account's views; undefined while they load (or when they can't be). */
	views: readonly ApplicationView[] | undefined;
};

const sameAddressFilters = (a: FilterSearch, b: FilterSearch) =>
	sameFilters(filtersFromSearch(a).filters, filtersFromSearch(b).filters);

/**
 * What opening Applications applies. A tab that was here before gets its state back, view included (a reload or Back
 * lands on the same filters, so the view stays on). A link with filters opens them with no view. A new tab opens the
 * default view, or All applications without one.
 */
export function openingFor({ address, stored, views }: OpeningInput): Opening {
	const fromLink = hasFilterParams(address);
	if (fromLink) {
		return stored && sameAddressFilters(stored.search, address)
			? { kind: "restore", tab: stored }
			: { kind: "address" };
	}
	if (stored) return { kind: "restore", tab: stored };
	if (views === undefined) return { kind: "wait" };
	const fallback = views.find((view) => view.isDefault);
	return fallback ? { kind: "view", view: fallback } : { kind: "all" };
}

/** The title row's parts, measured in px. */
export type TitleRowWidths = {
	/** The row's own width. */
	row: number;
	title: number;
	/** The tabs with their labels. */
	tabs: number;
	/** The Views button at its natural width; 0 when it isn't shown. */
	views: number;
	actions: number;
};

/** Below this the Views button's name ends in "…" before the tabs lose their labels. */
export const VIEWS_BUTTON_MIN = 200;
const TITLE_GAP = 20;
const TABS_GAP = 12;
const ACTIONS_GAP = 12;

/**
 * Whether the tabs keep their labels: the title, the tabs, the Views button (counted at up to 200px, its name ends
 * in "…" past that) and the actions fit on one line. Otherwise the tabs go icon only.
 */
export function tabLabelsFit({ row, title, tabs, views, actions }: TitleRowWidths): boolean {
	const viewsPart = views > 0 ? TABS_GAP + Math.min(views, VIEWS_BUTTON_MIN) : 0;
	return title + TITLE_GAP + tabs + viewsPart + ACTIONS_GAP + actions <= row;
}
