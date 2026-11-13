import { describe, expect, it } from "vitest";
import { atsReviewInputSchema, atsReviewOutputSchema } from "./ats-review";

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
