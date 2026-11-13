import { describe, expect, it } from "vitest";
import { aiLimitsSchema, factGroupSchema, savedItemDataSchema } from "./career";

describe("fact groups", () => {
	it("trims each level and drops empty ones", () => {
		expect(factGroupSchema.parse(" experience / acme/ ")).toBe("experience/acme");
		expect(factGroupSchema.parse("clearance")).toBe("clearance");
		expect(factGroupSchema.parse("//a///b")).toBe("a/b");
	});

	it("rejects a group with no name", () => {
		expect(factGroupSchema.safeParse(" / ").success).toBe(false);
		expect(factGroupSchema.safeParse("").success).toBe(false);
		expect(factGroupSchema.safeParse("x".repeat(201)).success).toBe(false);
	});
});

describe("AI limits", () => {
	const actionSizes = {
		actionPostingChars: 12_000,
		actionRequirementChars: 6000,
		actionNotesChars: 3000,
		actionSearchNotesChars: 3000,
		actionTargetingNotesChars: 6000,
		actionContactChars: 3000,
		actionResumeChars: 10_000,
		actionLetterChars: 6000,
		practiceStoryChars: 8500,
		fitRequirements: 20,
		postingRequirements: 30,
	};

	it("fills today's sizes for the application actions when none are saved", () => {
		expect(aiLimitsSchema.parse({})).toMatchObject(actionSizes);
	});

	it("reads limits saved before the action sizes existed, keeping what was saved", () => {
		const saved = { coachFacts: 50, actionFactChars: 20_000, actionTimeoutSeconds: 300 };
		expect(aiLimitsSchema.parse(saved)).toMatchObject({ ...saved, ...actionSizes });
	});

	it("refuses sizes outside their range", () => {
		expect(aiLimitsSchema.safeParse({ actionTargetingNotesChars: 499 }).success).toBe(false);
		expect(aiLimitsSchema.safeParse({ actionTargetingNotesChars: 1_000_001 }).success).toBe(false);
		expect(aiLimitsSchema.safeParse({ fitRequirements: 4 }).success).toBe(false);
		expect(aiLimitsSchema.safeParse({ postingRequirements: 101 }).success).toBe(false);
	});

	it("loads a saved Fit with up to 100 requirements, the most the setting allows", () => {
		const row = { text: "Go", origin: "posting", status: "supported", evidence: "Shown." };
		const fit = (rows: number) => ({
			kind: "fit",
			headline: "A relevant role",
			summary: "",
			requirements: Array.from({ length: rows }, () => row),
			checks: [],
			ask: null,
		});
		expect(savedItemDataSchema.safeParse(fit(100)).success).toBe(true);
		expect(savedItemDataSchema.safeParse(fit(101)).success).toBe(false);
	});
});
