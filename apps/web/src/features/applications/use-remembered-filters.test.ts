// @vitest-environment happy-dom

import type { FilterSearch } from "./filter-search";
import type { ApplicationView } from "@reactive-resume/schema/applications/views";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APPLICATION_VIEW_FILTERS } from "@reactive-resume/schema/applications/views";
import { REMEMBERED_FILTERS_KEY, readTabState, useRememberedFilters } from "./use-remembered-filters";

const memoryStorage = (initial?: unknown) => {
	const values = new Map<string, string>();
	if (initial) values.set(REMEMBERED_FILTERS_KEY, JSON.stringify(initial));
	return {
		getItem: vi.fn((key: string) => values.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => void values.set(key, value)),
		removeItem: vi.fn(),
		clear: vi.fn(),
		key: vi.fn(),
		length: 0,
		stored: () => JSON.parse(values.get(REMEMBERED_FILTERS_KEY) ?? "null") as unknown,
	};
};

const view = (patch: Partial<ApplicationView>): ApplicationView => ({
	id: "v1",
	name: "Ready to apply",
	filters: { ...DEFAULT_APPLICATION_VIEW_FILTERS, stage: ["saved"], build: ["built"] },
	layout: { sort: { sort: "fit", dir: "desc" }, listColumns: ["fit", "tfit"] },
	isDefault: false,
	position: 0,
	createdAt: new Date(),
	updatedAt: new Date(),
	...patch,
});

/** What the router gets: every filter and sort param, the given ones set. */
const restored = (onRestore: ReturnType<typeof vi.fn>) =>
	Object.fromEntries(Object.entries(onRestore.mock.calls[0]?.[0] ?? {}).filter(([, value]) => value !== undefined));

describe("useRememberedFilters", () => {
	it("keeps a link's filters with no view on, and saves them", () => {
		const storage = memoryStorage({ v: 2, search: { stage: "closed" }, viewId: "v1", viewColumns: null });
		const onRestore = vi.fn();
		const { result } = renderHook(() =>
			useRememberedFilters({ search: { stage: "saved", fit: 85 }, views: [view({})], onRestore, storage }),
		);
		expect(onRestore).not.toHaveBeenCalled();
		expect(result.current.viewId).toBeNull();
		expect(storage.stored()).toEqual({ v: 2, search: { stage: "saved", fit: 85 }, viewId: null, viewColumns: null });
	});

	it("brings back the tab's view after a reload, when the address has the same filters", () => {
		const storage = memoryStorage({
			v: 2,
			search: { stage: "saved", build: "built", sort: "fit" },
			viewId: "v1",
			viewColumns: ["fit"],
		});
		const { result } = renderHook(() =>
			useRememberedFilters({
				search: { stage: "saved", build: "built", sort: "fit" },
				views: undefined,
				onRestore: vi.fn(),
				storage,
			}),
		);
		expect(result.current).toMatchObject({ viewId: "v1", viewColumns: ["fit"] });
	});

	it("restores the stored filters and view when the address has none", () => {
		const storage = memoryStorage({ v: 2, search: { build: "built", sort: "fit" }, viewId: "v1", viewColumns: null });
		const onRestore = vi.fn();
		const { result } = renderHook(() => useRememberedFilters({ search: {}, views: undefined, onRestore, storage }));
		expect(restored(onRestore)).toEqual({ build: "built", sort: "fit" });
		expect(result.current.viewId).toBe("v1");
	});

	it("reads what tabs stored before saved views as no view, without a sort", () => {
		const storage = memoryStorage({ build: "built", sort: "role" });
		expect(readTabState(storage)).toEqual({ search: { build: "built" }, viewId: null, viewColumns: null });
		const onRestore = vi.fn();
		renderHook(() => useRememberedFilters({ search: {}, views: undefined, onRestore, storage }));
		expect(restored(onRestore)).toEqual({ build: "built" });
	});

	it("remembers the sort only while a view is on", () => {
		const storage = memoryStorage();
		const { result, rerender } = renderHook(
			({ search }) => useRememberedFilters({ search, views: [], onRestore: vi.fn(), storage }),
			{ initialProps: { search: { stage: "saved", sort: "added" } as FilterSearch } },
		);
		expect(storage.stored()).toMatchObject({ search: { stage: "saved" }, viewId: null });
		act(() => result.current.setTabView({ viewId: "v1", viewColumns: ["lane"] }));
		rerender({ search: { stage: "saved", sort: "added" } });
		expect(storage.stored()).toEqual({
			v: 2,
			search: { stage: "saved", sort: "added" },
			viewId: "v1",
			viewColumns: ["lane"],
		});
	});

	it("opens a new tab at the default view once the views load", () => {
		const storage = memoryStorage();
		const onRestore = vi.fn();
		const { result, rerender } = renderHook(
			({ views }) => useRememberedFilters({ search: { view: "list" } as FilterSearch, views, onRestore, storage }),
			{ initialProps: { views: undefined as ApplicationView[] | undefined } },
		);
		expect(onRestore).not.toHaveBeenCalled();
		// Nothing is stored while waiting, so a reload is still a new tab.
		expect(storage.stored()).toBeNull();
		rerender({ views: [view({ id: "v0" }), view({ id: "v1", isDefault: true })] });
		expect(result.current.viewId).toBe("v1");
		expect(restored(onRestore)).toEqual({ stage: "saved", build: "built", sort: "fit" });
	});

	it("opens a new tab at All applications without a default view", () => {
		const storage = memoryStorage();
		const onRestore = vi.fn();
		const { result } = renderHook(() => useRememberedFilters({ search: {}, views: [view({})], onRestore, storage }));
		expect(onRestore).not.toHaveBeenCalled();
		expect(result.current.viewId).toBeNull();
		expect(storage.stored()).toEqual({ v: 2, search: {}, viewId: null, viewColumns: null });
	});

	it("saves each change, and clearing later doesn't bring old filters back", () => {
		const storage = memoryStorage();
		const onRestore = vi.fn();
		const { rerender } = renderHook(({ search }) => useRememberedFilters({ search, views: [], onRestore, storage }), {
			initialProps: { search: {} as FilterSearch },
		});
		rerender({ search: { foundBy: ["Dorel", "Muse"] } });
		expect(storage.stored()).toMatchObject({ search: { foundBy: ["Dorel", "Muse"] } });
		rerender({ search: {} });
		expect(onRestore).not.toHaveBeenCalled();
		expect(storage.stored()).toMatchObject({ search: {} });
	});

	it("works without storage when it throws", () => {
		const storage = memoryStorage();
		storage.getItem.mockImplementation(() => {
			throw new Error("blocked");
		});
		storage.setItem.mockImplementation(() => {
			throw new Error("blocked");
		});
		const onRestore = vi.fn();
		expect(() => renderHook(() => useRememberedFilters({ search: {}, views: [], onRestore, storage }))).not.toThrow();
		expect(onRestore).not.toHaveBeenCalled();
	});

	it("ignores stored values that aren't a tab's state", () => {
		const storage = memoryStorage();
		storage.getItem.mockReturnValue("[1,2]");
		const onRestore = vi.fn();
		renderHook(() => useRememberedFilters({ search: { view: "list" } as FilterSearch, views: [], onRestore, storage }));
		expect(onRestore).not.toHaveBeenCalled();
	});
});
