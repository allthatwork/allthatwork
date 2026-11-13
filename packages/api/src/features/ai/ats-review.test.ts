import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("./generate-json", () => ({ generateJson: mocks.generate }));
vi.mock("./service", () => ({ getModel: () => ({}) }));

const { atsReviewInputSchema, atsReviewOutputSchema, reviewResumeText } = await import("./ats-review");

describe("rewrite suggestions", () => {
	const suggestions = Array.from({ length: 30 }, (_, index) => ({
		section: null,
		passageId: null,
		issue: `Issue ${index}`,
		rewrite: null,
		impact: "low",
	}));
	const review = (maxSuggestions: number) => {
		mocks.generate.mockImplementation(async (_model, _prompt, parser: { parse: (value: unknown) => unknown }) =>
			parser.parse({ summary: "", suggestions, strengths: [], jdAlignment: null }),
		);
		return reviewResumeText({
			...atsReviewInputSchema.parse({ extractedText: "Resume" }),
			maxSuggestions,
			provider: "openai",
			model: "m",
			apiKey: "k",
			baseURL: "",
		});
	};

	it("keeps as many suggestions as the user's limit, and asks the model for that many", async () => {
		expect((await review(12)).suggestions).toHaveLength(12);
		expect(String(mocks.generate.mock.lastCall?.[1]?.prompt)).toContain("at most 12 suggestions");
		expect((await review(25)).suggestions).toHaveLength(25);
		expect(String(mocks.generate.mock.lastCall?.[1]?.prompt)).toContain("at most 25 suggestions");
	});

	it("returns up to 30 through the API, the most the setting allows", () => {
		expect(atsReviewOutputSchema.parse({ summary: "", suggestions }).suggestions).toHaveLength(30);
	});
});

describe("atsReviewOutputSchema", () => {
	it("keeps the good entries when one is malformed", () => {
		const parsed = atsReviewOutputSchema.parse({
			summary: "Reads clearly.",
			suggestions: [
				{ section: null, issue: "Vague bullet.", rewrite: null, impact: "shouty" },
				{ section: null, issue: "", rewrite: null, impact: "low" },
			],
			strengths: ["Good", ""],
			jdAlignment: { verdict: "Close fit.", missingConcepts: ["kubernetes"], strengths: [] },
		});

		expect(parsed.suggestions).toHaveLength(1);
		expect(parsed.suggestions[0]?.impact).toBe("medium");
		expect(parsed.strengths).toEqual(["Good"]);
		expect(parsed.jdAlignment?.missingConcepts).toEqual(["kubernetes"]);
	});
});

describe("atsReviewInputSchema passages", () => {
	const input = (chars: number) => ({
		extractedText: "Resume",
		passages: [{ id: "p1", where: "Experience · bullet 1", text: "x".repeat(chars) }],
	});

	it("takes a 4,000-character passage whole and refuses a longer one", () => {
		expect(atsReviewInputSchema.parse(input(3000)).passages[0]?.text).toHaveLength(3000);
		expect(atsReviewInputSchema.safeParse(input(4000)).success).toBe(true);
		expect(atsReviewInputSchema.safeParse(input(4001)).success).toBe(false);
	});
});
