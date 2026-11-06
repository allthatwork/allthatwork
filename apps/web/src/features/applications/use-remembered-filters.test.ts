// @vitest-environment happy-dom

import type { FilterSearch } from "./filter-search";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { REMEMBERED_FILTERS_KEY, useRememberedFilters } from "./use-remembered-filters";

const memoryStorage = (initial?: FilterSearch) => {
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

describe("useRememberedFilters", () => {
	it("keeps the address's filters when it has some, and saves them", () => {
		const storage = memoryStorage({ stage: "closed" });
		const onRestore = vi.fn();
		renderHook(() => useRememberedFilters({ search: { stage: "saved", fit: 85 }, onRestore, storage }));
		expect(onRestore).not.toHaveBeenCalled();
		expect(storage.stored()).toEqual({ stage: "saved", fit: 85 });
	});

	it("restores the stored filters when the address has none", () => {
		const storage = memoryStorage({ build: "built", sort: "role" });
		const onRestore = vi.fn();
		renderHook(() => useRememberedFilters({ search: {}, onRestore, storage }));
		expect(onRestore).toHaveBeenCalledExactlyOnceWith({ build: "built", sort: "role" });
	});

	it("starts at the default with nothing stored, and saves each change", () => {
		const storage = memoryStorage();
		const onRestore = vi.fn();
		const { rerender } = renderHook(({ search }) => useRememberedFilters({ search, onRestore, storage }), {
			initialProps: { search: {} as FilterSearch },
		});
		expect(onRestore).not.toHaveBeenCalled();
		expect(storage.stored()).toEqual({});
		rerender({ search: { foundBy: ["Dorel", "Muse"] } });
		expect(storage.stored()).toEqual({ foundBy: ["Dorel", "Muse"] });
		// Clearing everything later doesn't bring the old filters back: only opening the page restores.
		rerender({ search: {} });
		expect(onRestore).not.toHaveBeenCalled();
		expect(storage.stored()).toEqual({});
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
		expect(() => renderHook(() => useRememberedFilters({ search: {}, onRestore, storage }))).not.toThrow();
		expect(onRestore).not.toHaveBeenCalled();
	});

	it("ignores stored values that aren't filters", () => {
		const storage = memoryStorage();
		storage.getItem.mockReturnValue("[1,2]");
		const onRestore = vi.fn();
		renderHook(() => useRememberedFilters({ search: { view: "list" } as FilterSearch, onRestore, storage }));
		expect(onRestore).not.toHaveBeenCalled();
	});
});
