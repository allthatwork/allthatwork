import type { FilterSearch } from "./filter-search";
import { useEffect, useEffectEvent, useRef } from "react";
import { hasFilterParams, REMEMBERED_SEARCH_KEYS } from "./filter-search";

export const REMEMBERED_FILTERS_KEY = "applications-filters";

const getStorage = () => {
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
};

function read(storage: Storage | null): FilterSearch | null {
	try {
		const raw = storage?.getItem(REMEMBERED_FILTERS_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as FilterSearch) : null;
	} catch {
		return null;
	}
}

function write(storage: Storage | null, search: FilterSearch) {
	try {
		storage?.setItem(REMEMBERED_FILTERS_KEY, JSON.stringify(search));
	} catch {
		// Without storage the tab doesn't remember its filters; the address still holds them.
	}
}

/** Only the filter params, without the undefined ones; the sort is the account's, not the tab's. */
const pickFilterParams = (search: FilterSearch): FilterSearch =>
	Object.fromEntries(REMEMBERED_SEARCH_KEYS.flatMap((key) => (search[key] === undefined ? [] : [[key, search[key]]])));

type RememberedFiltersOptions = {
	/** The filter and sort params in the address now. */
	search: FilterSearch;
	/** Puts stored params into the address (with `replace: true`). */
	onRestore: (search: FilterSearch) => void;
	/** For tests; the tab's sessionStorage by default. */
	storage?: Storage | null;
};

/**
 * The tab remembers its filters: every change is saved to sessionStorage, and opening Applications with no filter params
 * in the address (the sidebar link, coming back from a workspace) brings back this tab's last ones. A new tab starts
 * at the default.
 */
export function useRememberedFilters({ search, onRestore, storage }: RememberedFiltersOptions) {
	const opened = useRef(false);
	const params = pickFilterParams(search);
	const key = JSON.stringify(params);
	const restore = useEffectEvent(onRestore);

	useEffect(() => {
		const store = storage === undefined ? getStorage() : storage;
		const current = JSON.parse(key) as FilterSearch;
		if (!opened.current) {
			opened.current = true;
			if (!hasFilterParams(current)) {
				const stored = read(store);
				if (stored && hasFilterParams(stored)) {
					restore(pickFilterParams(stored));
					return;
				}
			}
		}
		write(store, current);
	}, [key, storage]);
}
