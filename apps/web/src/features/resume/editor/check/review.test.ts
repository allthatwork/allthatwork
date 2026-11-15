import type { Passage } from "@reactive-resume/resume/proposals";
import { describe, expect, it } from "vite-plus/test";
import { getStateIn } from "@reactive-resume/resume/proposals";
import { editWritingProposal, mapWritingReview, reviewPassages } from "./review";

const passage = (id: string, chars: number): Passage => {
	const text = "w".repeat(chars);
	return {
		id,
		target: { sectionId: "experience", itemId: "e1", field: "description" },
		location: `Experience › ${id}`,
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
		expect(proposals.map((proposal) => proposal.location)).toEqual(["Experience › short"]);
		expect(notes).toEqual([expect.objectContaining({ note: "Too long.", location: "Experience", quote: "" })]);
	});
});

it("does not reuse an accepted proposal identity for a fresh writing review", () => {
	const passages = [
		{
			id: "passage",
			target: { sectionId: "summary", field: "content" },
			html: "<p>Original</p>",
			text: "Original",
			location: "Summary",
		},
	];
	const suggestions = [
		{ passageId: "passage", section: null, issue: "Clearer", rewrite: "Rewritten", impact: "high" as const },
	];
	const first = mapWritingReview(suggestions, passages).proposals[0];
	const next = mapWritingReview(suggestions, passages).proposals[0];
	if (!first || !next) throw new Error("Missing proposals");
	expect(next.id).not.toBe(first.id);
	expect(getStateIn("<p>Original</p>", next, { [first.id]: true })).toBe("pending");
});

it("keeps stale original and rewrite readable without an applicable proposal", () => {
	const result = mapWritingReview(
		[
			{
				section: "Summary",
				passageId: "old",
				issue: "Be specific",
				rewrite: "Built fictional systems",
				impact: "medium",
			},
		],
		[],
		[{ id: "old", where: "Summary paragraph 1", text: "Worked on fictional systems" }],
	);
	expect(result.proposals).toEqual([]);
	expect(result.notes).toEqual([
		{
			location: "Summary paragraph 1",
			impact: "medium",
			quote: "Worked on fictional systems",
			rewrite: "Built fictional systems",
			note: "Be specific",
			target: null,
		},
	]);
});

it("flags new writing claims for individual confirmation using the shared proposal guard", () => {
	const passages = [
		{
			id: "bullet",
			target: { sectionId: "experience", itemId: "role", field: "description" },
			html: "<li>Built systems.</li>",
			text: "Built systems.",
			location: "Experience",
		},
	];
	const review = (rewrite: string) =>
		mapWritingReview(
			[{ section: "Experience", passageId: "bullet", issue: "Be specific", rewrite, impact: "medium" }],
			passages,
		).proposals[0];
	expect(review("Built systems for 40 engineers.")).toMatchObject({
		addsClaims: true,
		unsupported: expect.arrayContaining([expect.objectContaining({ kind: "figure" })]),
	});
	expect(review("Built systems.")).toBeUndefined();
	expect(review("Built systems")).not.toHaveProperty("addsClaims");
});

it("rechecks edited writing claims while preserving proposal identity and AI receipt", () => {
	const passages = [
		{
			id: "bullet",
			target: { sectionId: "experience", itemId: "role", field: "description" },
			html: "<li>Built systems.</li>",
			text: "Built systems.",
			location: "Experience",
		},
	];
	const proposal = mapWritingReview(
		[
			{
				section: "Experience",
				passageId: "bullet",
				issue: "Clearer",
				rewrite: "Built better systems.",
				impact: "medium",
			},
		],
		passages,
	).proposals[0];
	if (!proposal) throw new Error("Missing proposal");
	const original = { ...proposal, aiOperationIds: ["receipt"] };
	const edited = editWritingProposal(original, "Built systems for 40 engineers.", passages, "Built systems.");
	expect(edited).toMatchObject({
		id: original.id,
		before: original.before,
		after: "<li>Built systems for 40 engineers.</li>",
		edited: true,
		aiOperationIds: ["receipt"],
		addsClaims: true,
		unsupported: expect.arrayContaining([expect.objectContaining({ kind: "figure" })]),
	});
	expect(editWritingProposal(edited, "Built systems.", passages, "Built systems.")).toMatchObject({
		addsClaims: false,
		unsupported: [],
	});
});
