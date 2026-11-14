import { describe, expect, it } from "vite-plus/test";
import {
	aiLimitsSchema,
	careerOfferInputSchema,
	careerProfileDataSchema,
	factGroupSchema,
	savedItemDataSchema,
} from "./career";

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

	const otherLimits = {
		coachApplications: 50,
		coachInterviews: 30,
		replySteps: 30,
		replyOutputTokens: 8192,
		replyContextTokens: null,
		attachmentTextChars: 40_000,
		replyWebCalls: 6,
		reviewBatches: 8,
		reviewBatchChars: null,
		reviewSuggestions: 12,
		recordingSeconds: 120,
		requestTimeoutSeconds: 120,
		modelRetries: 2,
		jsonOutputTokens: null,
		boardFetchTimeoutSeconds: 30,
		webPageChars: 20_000,
		webSearchResults: 5,
	};

	it("gives today's numbers for the Coach, replies, reviews, voice and web limits, with three left blank", () => {
		expect(aiLimitsSchema.parse({})).toMatchObject(otherLimits);
	});

	it("reads limits saved before these existed, keeping what was saved", () => {
		const saved = { ...actionSizes, coachFacts: 40, webCallTimeoutSeconds: 45 };
		expect(aiLimitsSchema.parse(saved)).toEqual({ ...aiLimitsSchema.parse({}), ...saved });
	});

	it("keeps a number in a blank-by-default field, and refuses one outside its range", () => {
		expect(aiLimitsSchema.parse({ replyContextTokens: 150_000 }).replyContextTokens).toBe(150_000);
		expect(aiLimitsSchema.parse({ reviewBatchChars: null }).reviewBatchChars).toBeNull();
		expect(aiLimitsSchema.safeParse({ replyContextTokens: 9999 }).success).toBe(false);
		expect(aiLimitsSchema.safeParse({ jsonOutputTokens: 64_001 }).success).toBe(false);
		expect(aiLimitsSchema.safeParse({ coachApplications: 9 }).success).toBe(false);
		expect(aiLimitsSchema.safeParse({ replyWebCalls: 0 }).success).toBe(true);
		expect(aiLimitsSchema.safeParse({ webSearchResults: 21 }).success).toBe(false);
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

describe("careerProfileDataSchema searchRegions", () => {
	it("leaves searchRegions absent when the input has none", () => {
		const parsed = careerProfileDataSchema.parse({});

		expect(parsed.searchRegions).toBeUndefined();
		expect(Object.hasOwn(parsed, "searchRegions")).toBe(false);
	});

	it("keeps chosen countries, an empty list and null", () => {
		expect(careerProfileDataSchema.parse({ searchRegions: ["SG"] }).searchRegions).toEqual(["SG"]);
		expect(careerProfileDataSchema.parse({ searchRegions: [] }).searchRegions).toEqual([]);
		expect(careerProfileDataSchema.parse({ searchRegions: null }).searchRegions).toBeNull();
	});

	it("rejects invalid search regions", () => {
		expect(careerProfileDataSchema.safeParse({ searchRegions: ["XX"] }).success).toBe(false);
		expect(careerProfileDataSchema.safeParse({ searchRegions: ["SG", "SG"] }).success).toBe(false);
		expect(careerProfileDataSchema.safeParse({ searchRegions: ["SG", "AU", "DE", "FR"] }).success).toBe(false);
	});
});

describe("manual offer input", () => {
	const input = { applicationId: "application", currency: "EUR", period: "year", base: 95000, variable: null };
	it("keeps unknown amounts distinct from zero and preserves explicit terms", () => {
		expect(careerOfferInputSchema.parse({ ...input, base: null, variable: 0, period: "hour" })).toMatchObject({
			base: null,
			variable: 0,
			learning: null,
			period: "hour",
		});
	});
	it.each([
		{ applicationId: "" },
		{ currency: "eur" },
		{ currency: "EURO" },
		{ period: "week" },
		{ base: -1 },
		{ variable: Infinity },
		{ learning: -1 },
		{ officeDays: 6 },
		{ officeDays: 1.5 },
		{ equity: "x".repeat(1001) },
		{ respondBy: "tomorrow" },
	])("rejects invalid terms %j", (patch) => {
		expect(careerOfferInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
	});
});
