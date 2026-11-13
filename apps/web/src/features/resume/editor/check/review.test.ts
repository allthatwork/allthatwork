import type { Passage } from "@reactive-resume/resume/proposals";
import { describe, expect, it } from "vitest";
import { mapWritingReview, reviewPassages } from "./review";

const passage = (id: string, chars: number): Passage => {
	const text = "w".repeat(chars);
	return {
		id,
		target: { sectionId: "experience", itemId: "e1", field: "description" },
		location: `Experience · ${id}`,
		html: `<li><p>${text}</p></li>`,
		text,
	};
};

describe("writing review passages", () => {
	it("sends a 3,000-character passage whole and leaves a 5,000-character one out", () => {
		const sent = reviewPassages([passage("short", 3000), passage("long", 5000)]);
		expect(sent.map((entry) => [entry.id, entry.text.length])).toEqual([["short", 3000]]);
	});

	it("keeps 120 passages that fit, counting only those", () => {
		const passages = [passage("long", 5000), ...Array.from({ length: 130 }, (_, index) => passage(`p${index}`, 10))];
		const sent = reviewPassages(passages);
		expect(sent).toHaveLength(120);
		expect(sent[0]?.id).toBe("p0");
	});

	it("never offers a rewrite for a passage it didn't send", () => {
		const all = [passage("short", 3000), passage("long", 5000)];
		const { proposals, notes } = mapWritingReview(
			[
				{ section: null, passageId: "short", issue: "Tighter.", rewrite: "Shorter.", impact: "medium" },
				{ section: "Experience", passageId: "long", issue: "Too long.", rewrite: "Cut.", impact: "high" },
			],
			reviewPassages(all),
		);
		expect(proposals.map((proposal) => proposal.location)).toEqual(["Experience · short"]);
		expect(notes).toEqual([expect.objectContaining({ note: "Too long.", location: "Experience", quote: "" })]);
	});
});
