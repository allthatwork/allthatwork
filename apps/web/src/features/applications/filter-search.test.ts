import { describe, expect, it } from "vitest";
import {
	DEFAULT_APPLICATION_FILTERS,
	DEFAULT_APPLICATION_SORT,
	OPEN_STAGES,
} from "@reactive-resume/schema/applications/filters";
import { filtersFromSearch, hasFilterParams, searchFromFilters, sortFromSearch } from "./filter-search";

describe("filtersFromSearch", () => {
	it("gives the defaults for an empty address", () => {
		expect(filtersFromSearch({})).toEqual({ filters: DEFAULT_APPLICATION_FILTERS, sort: DEFAULT_APPLICATION_SORT });
	});

	it("reads single values, lists and the numbers the router parses", () => {
		const { filters, sort } = filtersFromSearch({
			stage: "saved",
			build: "built",
			foundBy: ["Dorel", "Muse"],
			fit: 85,
			added: 7,
			tag: 2024,
			q: "sre",
			sort: "fit",
			dir: "asc",
		});
		expect(filters).toMatchObject({
			stage: ["saved"],
			build: ["built"],
			foundBy: ["Dorel", "Muse"],
			fit: "85",
			added: "7",
			tag: ["2024"],
			q: "sre",
		});
		expect(sort).toEqual({ sort: "fit", dir: "asc" });
	});

	it("falls back to the default for values that aren't valid", () => {
		const { filters, sort } = filtersFromSearch({ stage: ["nope"], fit: "high", build: ["built", "soon"], sort: "x" });
		expect(filters.stage).toEqual([...OPEN_STAGES]);
		expect(filters.fit).toBe("any");
		expect(filters.build).toEqual([]);
		expect(sort).toEqual(DEFAULT_APPLICATION_SORT);
	});

	it("reads any whole number for Fit and Dates, clamped", () => {
		const { filters } = filtersFromSearch({ fit: 42, tfit: 150, added: 400, updated: 0 });
		expect([filters.fit, filters.tfit, filters.added, filters.updated]).toEqual(["42", "100", "365", "any"]);
	});

	it("maps old closed=true links onto the stages", () => {
		expect(filtersFromSearch({ closed: true }).filters.stage).toEqual([...OPEN_STAGES, "closed"]);
		expect(filtersFromSearch({ closed: true, stage: "saved" }).filters.stage).toEqual(["saved", "closed"]);
		expect(filtersFromSearch({ closed: false }).filters.stage).toEqual([...OPEN_STAGES]);
	});
});

describe("searchFromFilters", () => {
	it("leaves defaults out and writes one value plainly, presets as numbers", () => {
		const search = searchFromFilters(
			{ ...DEFAULT_APPLICATION_FILTERS, stage: ["saved"], build: ["built"], fit: "85", foundBy: ["Dorel", "Muse"] },
			DEFAULT_APPLICATION_SORT,
		);
		expect(Object.fromEntries(Object.entries(search).filter(([, value]) => value !== undefined))).toEqual({
			stage: "saved",
			build: "built",
			fit: 85,
			foundBy: ["Dorel", "Muse"],
		});
		// Every key is there, so a cleared filter leaves the address.
		expect("lane" in search && search.lane === undefined).toBe(true);
		expect(search.closed).toBeUndefined();
	});

	it("leaves the open stages out in any order, and writes the sort when it isn't the default", () => {
		const search = searchFromFilters(
			{ ...DEFAULT_APPLICATION_FILTERS, stage: ["offer", "interview", "screening", "applied", "saved"] },
			{ sort: "role", dir: "asc" },
		);
		expect(search.stage).toBeUndefined();
		expect([search.sort, search.dir]).toEqual(["role", "asc"]);
	});

	it("round-trips typed numbers: fit=75&added=10, and reads an old tfit=none as any", () => {
		const filters = { ...DEFAULT_APPLICATION_FILTERS, fit: "75", added: "10", updated: "3" };
		const search = searchFromFilters(filters, DEFAULT_APPLICATION_SORT);
		expect([search.fit, search.tfit, search.added, search.updated]).toEqual([75, undefined, 10, 3]);
		expect(filtersFromSearch(search).filters).toEqual(filters);
		// The router may hand the numbers back as text; they read the same.
		expect(filtersFromSearch({ fit: "75", tfit: "none", added: "10", updated: "3" }).filters).toEqual(filters);
	});

	it("round-trips reviewer fits: rfit=B:80, several as a list", () => {
		const one = { ...DEFAULT_APPLICATION_FILTERS, rfit: ["B:80"] };
		expect(searchFromFilters(one, DEFAULT_APPLICATION_SORT).rfit).toBe("B:80");
		expect(filtersFromSearch(searchFromFilters(one, DEFAULT_APPLICATION_SORT)).filters).toEqual(one);
		const two = { ...DEFAULT_APPLICATION_FILTERS, rfit: ["A:75", "B:80"] };
		expect(searchFromFilters(two, DEFAULT_APPLICATION_SORT).rfit).toEqual(["A:75", "B:80"]);
		expect(filtersFromSearch({ rfit: ["B:80", "A:75", "C:abc"] }).filters).toEqual(two);
	});

	it("round-trips", () => {
		const filters = {
			...DEFAULT_APPLICATION_FILTERS,
			q: "staff",
			stage: [...OPEN_STAGES, "closed" as const],
			lane: ["Platform / reliability"],
			laneMode: "primary" as const,
			tfit: "70",
			rfit: ["B:80"],
			notTag: ["agency"],
			resume: "linked" as const,
		};
		const sort = { sort: "next" as const, dir: "desc" as const };
		expect(filtersFromSearch(searchFromFilters(filters, sort))).toEqual({ filters, sort });
	});
});

it("knows when the address holds filters", () => {
	expect(hasFilterParams({ view: "list", applicationId: "a", create: true })).toBe(false);
	expect(hasFilterParams({ view: "list", stage: "saved" })).toBe(true);
	expect(hasFilterParams({ closed: true })).toBe(true);
	// The sort is the account's, so an address with only a sort still opens the tab's remembered filters.
	expect(hasFilterParams({ sort: "role", dir: "asc" })).toBe(false);
});

describe("sortFromSearch", () => {
	it("is null when the address has no sort, so the account's applies", () => {
		expect(sortFromSearch({})).toBeNull();
	});

	it("reads a key, a direction or both, each missing half at its default", () => {
		expect(sortFromSearch({ sort: "added" })).toEqual({ sort: "added", dir: "desc" });
		expect(sortFromSearch({ dir: "asc" })).toEqual({ sort: "updated", dir: "asc" });
		expect(sortFromSearch({ sort: "company", dir: "asc" })).toEqual({ sort: "company", dir: "asc" });
	});

	it("treats a value that isn't valid as no sort", () => {
		expect(sortFromSearch({ sort: "salary" })).toBeNull();
		expect(sortFromSearch({ sort: "fit", dir: "sideways" })).toBeNull();
	});
});
