import { describe, expect, it } from "vitest";
import { applicationFiltersSchema, normalizeDaysFilter, normalizeFitFilter } from "./filters";

describe("fit filters", () => {
	it("takes any whole number from 0 to 100, as text", () => {
		expect(normalizeFitFilter("75")).toBe("75");
		expect(normalizeFitFilter("0")).toBe("0");
		expect(normalizeFitFilter("100")).toBe("100");
		expect(normalizeFitFilter(88)).toBe("88");
		expect(normalizeFitFilter(" 075 ")).toBe("75");
	});

	it("clamps more than 100 to 100", () => {
		expect(normalizeFitFilter("150")).toBe("100");
		expect(normalizeFitFilter(999)).toBe("100");
	});

	it("keeps any and none, and reads anything else as any", () => {
		expect(normalizeFitFilter("any")).toBe("any");
		expect(normalizeFitFilter("none")).toBe("none");
		for (const value of ["", "abc", "7.5", "-3", "85+", 7.5, -3]) expect(normalizeFitFilter(value)).toBe("any");
	});
});

describe("date filters", () => {
	it("takes any whole number of days from 1 to 365, as text", () => {
		expect(normalizeDaysFilter("10")).toBe("10");
		expect(normalizeDaysFilter(1)).toBe("1");
		expect(normalizeDaysFilter("365")).toBe("365");
	});

	it("clamps more than 365 to 365", () => {
		expect(normalizeDaysFilter("400")).toBe("365");
	});

	it("reads 0, empty and anything else as any", () => {
		for (const value of ["0", 0, "", "any", "none", "soon", "1.5", "-7"])
			expect(normalizeDaysFilter(value)).toBe("any");
	});
});

describe("applicationFiltersSchema", () => {
	it("parses typed numbers and old presets alike", () => {
		const filters = applicationFiltersSchema.parse({ fit: "75", tfit: "none", added: "10", updated: 14 });
		expect(filters).toMatchObject({ fit: "75", tfit: "none", added: "10", updated: "14" });
		expect(applicationFiltersSchema.parse({ fit: "85", added: "14" })).toMatchObject({ fit: "85", added: "14" });
	});

	it("never fails on out-of-range or odd values", () => {
		const parsed = applicationFiltersSchema.safeParse({ fit: "150", tfit: "x", added: "400", updated: "0" });
		expect(parsed.success).toBe(true);
		expect(parsed.data).toMatchObject({ fit: "100", tfit: "any", added: "365", updated: "any" });
	});

	it("defaults to any", () => {
		expect(applicationFiltersSchema.parse({})).toMatchObject({ fit: "any", tfit: "any", added: "any", updated: "any" });
	});
});
