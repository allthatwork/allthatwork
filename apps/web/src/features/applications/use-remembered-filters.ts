import type { FilterSearch } from "./filter-search";
import type { Opening, TabState } from "./saved-views";
import type { ListColumnId } from "@reactive-resume/schema/applications/layout";
import type { ApplicationView } from "@reactive-resume/schema/applications/views";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { LIST_COLUMN_IDS } from "@reactive-resume/schema/applications/layout";
import { FILTER_SEARCH_KEYS, REMEMBERED_SEARCH_KEYS, searchFromFilters } from "./filter-search";
import { filtersOfView, openingFor } from "./saved-views";

export const REMEMBERED_FILTERS_KEY = "applications-filters";

const getStorage = () => {
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const readColumns = (value: unknown): ListColumnId[] | null =>
	Array.isArray(value)
		? [...new Set(value.filter((id): id is ListColumnId => (LIST_COLUMN_IDS as readonly unknown[]).includes(id)))]
		: null;

/** The tab's state; before saved views it was the filter params alone, which still read as no view. */
export function readTabState(storage: Storage | null): TabState | null {
	try {
		const raw = storage?.getItem(REMEMBERED_FILTERS_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as unknown;
		if (!isRecord(parsed)) return null;
		if (parsed.v !== 2) return { search: pickParams(parsed as FilterSearch, false), viewId: null, viewColumns: null };
		const viewId = typeof parsed.viewId === "string" ? parsed.viewId : null;
		return {
			search: isRecord(parsed.search) ? pickParams(parsed.search as FilterSearch, viewId !== null) : {},
			viewId,
			viewColumns: viewId ? readColumns(parsed.viewColumns) : null,
		};
	} catch {
		return null;
	}
}

function write(storage: Storage | null, state: TabState) {
	try {
		storage?.setItem(REMEMBERED_FILTERS_KEY, JSON.stringify({ v: 2, ...state }));
	} catch {
		// Without storage the tab doesn't remember its filters; the address still holds them.
	}
}

const SORT_KEYS = ["sort", "dir"] as const;

/**
 * The params a tab keeps, without the undefined ones: the filters, and the sort only while a view is on (without one
 * the sort is the account's).
 */
function pickParams(search: FilterSearch, withSort: boolean): FilterSearch {
	const keys = withSort ? [...REMEMBERED_SEARCH_KEYS, ...SORT_KEYS] : REMEMBERED_SEARCH_KEYS;
	return Object.fromEntries(keys.flatMap((key) => (search[key] === undefined ? [] : [[key, search[key]]])));
}

/** Every filter and sort param, set to these (the rest cleared), for the router to merge into the address. */
const fullSearch = (search: FilterSearch): FilterSearch => ({
	...Object.fromEntries(FILTER_SEARCH_KEYS.map((key) => [key, undefined])),
	...search,
});

export type TabView = { viewId: string | null; viewColumns: ListColumnId[] | null };

const NO_VIEW: TabView = { viewId: null, viewColumns: null };

type RememberedFiltersOptions = {
	/** The filter and sort params in the address now. */
	search: FilterSearch;
	/** The account's saved views; undefined while they load. */
	views: readonly ApplicationView[] | undefined;
	/** Puts these filter and sort params into the address (with `replace: true`); the others are undefined. */
	onRestore: (search: FilterSearch) => void;
	/** For tests; the tab's sessionStorage by default. */
	storage?: Storage | null;
};

/**
 * The tab remembers its filters, the view that's on and the view's unsaved columns: every change is saved to
 * sessionStorage. Opening Applications brings back this tab's last state (with no filters in the address, or with the
 * same ones after a reload); a new tab opens the default view, or All applications; a link with filters opens those,
 * with no view.
 */
export function useRememberedFilters({ search, views, onRestore, storage }: RememberedFiltersOptions) {
	const store = storage === undefined ? getStorage() : storage;
	// A restored view is on from the first render, so its columns don't flash the account's.
	const [tabView, setTabView] = useState<TabView>(() => {
		const opening = openingFor({ address: search, stored: readTabState(store), views: undefined });
		return opening.kind === "restore" ? { viewId: opening.tab.viewId, viewColumns: opening.tab.viewColumns } : NO_VIEW;
	});
	const opened = useRef(false);
	const restore = useEffectEvent(onRestore);
	const decide = useEffectEvent((): Opening => openingFor({ address: search, stored: readTabState(store), views }));

	const inView = tabView.viewId !== null;
	const params = pickParams(search, inView);
	const key = JSON.stringify([params, tabView]);
	const viewsLoaded = views !== undefined;

	useEffect(() => {
		if (!opened.current) {
			const opening = decide();
			if (opening.kind === "wait") return;
			opened.current = true;
			if (opening.kind === "restore") {
				// The view is already on (the state starts from the same decision).
				restore(fullSearch(opening.tab.search));
				return;
			}
			if (opening.kind === "view") {
				// oxlint-disable-next-line react/set-state-in-effect -- the default view is known only once the views have loaded
				setTabView({ viewId: opening.view.id, viewColumns: null });
				restore(fullSearch(searchFromFilters(filtersOfView(opening.view), opening.view.layout.sort)));
				return;
			}
		}
		const [current, view] = JSON.parse(key) as [FilterSearch, TabView];
		write(store, { search: current, ...view });
	}, [key, viewsLoaded, store]);

	return { ...tabView, setTabView };
}
