import { describe, expect, it } from "vitest";
import {
	DEFAULT_APPLICATION_FILTERS,
	DEFAULT_APPLICATION_SORT,
	OPEN_STAGES,
} from "@reactive-resume/schema/applications/filters";
import { filtersFromSearch, hasFilterParams, searchFromFilters } from "./filter-search";

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
		const { filters, sort } = filtersFromSearch({ stage: ["nope"], fit: 42, build: ["built", "soon"], sort: "x" });
		expect(filters.stage).toEqual([...OPEN_STAGES]);
		expect(filters.fit).toBe("any");
		expect(filters.build).toEqual([]);
		expect(sort).toEqual(DEFAULT_APPLICATION_SORT);
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

	it("round-trips", () => {
		const filters = {
			...DEFAULT_APPLICATION_FILTERS,
			q: "staff",
			stage: [...OPEN_STAGES, "closed" as const],
			lane: ["Platform / reliability"],
			laneMode: "primary" as const,
			tfit: "none" as const,
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
	expect(hasFilterParams({ sort: "role" })).toBe(true);
});
