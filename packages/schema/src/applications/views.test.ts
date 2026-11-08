import { describe, expect, it } from "vitest";
import { DEFAULT_APPLICATION_SORT } from "./filters";
import { DEFAULT_LIST_COLUMNS } from "./layout";
import {
	applicationViewFiltersSchema,
	applicationViewLayoutSchema,
	applicationViewNameSchema,
	DEFAULT_APPLICATION_VIEW_FILTERS,
	readApplicationViewFilters,
	readApplicationViewLayout,
} from "./views";

describe("applicationViewNameSchema", () => {
	it("trims and takes 1 to 60 characters", () => {
		expect(applicationViewNameSchema.parse("  Ready to apply ")).toBe("Ready to apply");
		expect(applicationViewNameSchema.safeParse("   ").success).toBe(false);
		expect(applicationViewNameSchema.safeParse("x".repeat(60)).success).toBe(true);
		expect(applicationViewNameSchema.safeParse("x".repeat(61)).success).toBe(false);
	});
});

describe("applicationViewFiltersSchema", () => {
	it("keeps the filters without the search text", () => {
		const parsed = applicationViewFiltersSchema.parse({ q: "acme", stage: ["saved"], build: ["built"] });
		expect(parsed).not.toHaveProperty("q");
		expect(parsed.stage).toEqual(["saved"]);
		expect(parsed.build).toEqual(["built"]);
	});
});

describe("applicationViewLayoutSchema", () => {
	it("takes a sort and column ids, each once", () => {
		expect(
			applicationViewLayoutSchema.parse({ sort: { sort: "fit", dir: "desc" }, listColumns: ["fit", "tfit"] }),
		).toEqual({ sort: { sort: "fit", dir: "desc" }, listColumns: ["fit", "tfit"] });
		expect(applicationViewLayoutSchema.safeParse({ sort: {}, listColumns: ["fit", "fit"] }).success).toBe(false);
		expect(applicationViewLayoutSchema.safeParse({ sort: {}, listColumns: ["role"] }).success).toBe(false);
	});
});

describe("readApplicationViewFilters", () => {
	it("returns the defaults for nothing readable", () => {
		expect(readApplicationViewFilters(null)).toEqual(DEFAULT_APPLICATION_VIEW_FILTERS);
		expect(readApplicationViewFilters("nope")).toEqual(DEFAULT_APPLICATION_VIEW_FILTERS);
		expect(readApplicationViewFilters([1])).toEqual(DEFAULT_APPLICATION_VIEW_FILTERS);
	});

	it("keeps valid fields and falls back per field", () => {
		const filters = readApplicationViewFilters({
			stage: ["saved"],
			build: ["built"],
			// A shape a later change might give Fit: not readable now, so Fit is back at any.
			fit: { min: 85 },
			added: "365",
			foundBy: ["Dorel"],
			q: "dropped",
			retired: true,
		});
		expect(filters.stage).toEqual(["saved"]);
		expect(filters.build).toEqual(["built"]);
		expect(filters.fit).toBe("any");
		expect(filters.added).toBe("any");
		expect(filters.foundBy).toEqual(["Dorel"]);
		expect(filters).not.toHaveProperty("q");
		expect(filters).not.toHaveProperty("retired");
	});

	it("keeps a list's valid values and drops the rest", () => {
		const filters = readApplicationViewFilters({ build: ["built", "retired"], stage: ["gone", "applied"] });
		expect(filters.build).toEqual(["built"]);
		expect(filters.stage).toEqual(["applied"]);
	});

	it("never leaves Stage empty", () => {
		expect(readApplicationViewFilters({ stage: [] }).stage).toEqual(DEFAULT_APPLICATION_VIEW_FILTERS.stage);
		expect(readApplicationViewFilters({ stage: ["gone"] }).stage).toEqual(DEFAULT_APPLICATION_VIEW_FILTERS.stage);
	});
});

describe("readApplicationViewLayout", () => {
	it("returns the default sort and columns for nothing readable", () => {
		expect(readApplicationViewLayout(undefined)).toEqual({
			sort: DEFAULT_APPLICATION_SORT,
			listColumns: [...DEFAULT_LIST_COLUMNS],
		});
	});

	it("drops unknown and repeated columns and keeps the order", () => {
		expect(
			readApplicationViewLayout({ sort: { sort: "next", dir: "asc" }, listColumns: ["lane", "x", "fit", "lane"] }),
		).toEqual({
			sort: { sort: "next", dir: "asc" },
			listColumns: ["lane", "fit"],
		});
	});

	it("falls back to the default sort when the stored one isn't valid", () => {
		expect(readApplicationViewLayout({ sort: { sort: "salary" }, listColumns: [] })).toEqual({
			sort: DEFAULT_APPLICATION_SORT,
			listColumns: [],
		});
	});
});
