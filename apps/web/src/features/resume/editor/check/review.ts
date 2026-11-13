import type { WritingNote } from "../store";
import type { PageMapTarget } from "@reactive-resume/pdf/page-map";
import type { Passage, Proposal } from "@reactive-resume/resume/proposals";
import { replaceBlockText } from "@reactive-resume/resume/proposals";

type ReviewSuggestion = {
	section: string | null;
	passageId: string | null;
	issue: string;
	rewrite: string | null;
	impact: WritingNote["impact"];
};

/** The endpoint's caps on passages: how many, and the longest one it may rewrite. */
const MAX_PASSAGES = 120;
const MAX_PASSAGE_CHARS = 4_000;

/**
 * The passages a writing review may rewrite. An accepted rewrite replaces the whole passage, so each one goes whole:
 * one longer than the cap is left out (the review still reads it in the resume's text, but can't rewrite it).
 */
export function reviewPassages(passages: readonly Passage[]) {
	return passages.filter((passage) => passage.text.length <= MAX_PASSAGE_CHARS).slice(0, MAX_PASSAGES);
}

const toPageTarget = (target: Proposal["target"]): PageMapTarget =>
	target.itemId
		? { kind: "item", sectionId: target.sectionId, itemId: target.itemId }
		: { kind: "section", sectionId: target.sectionId };

/**
 * Sorts a writing review's suggestions: a rewrite of a passage that was sent becomes a proposal to accept or
 * reject; anything else (advice, or a rewrite of text it wasn't given) stays a note.
 */
export function mapWritingReview(suggestions: readonly ReviewSuggestion[], passages: readonly Passage[]) {
	const byId = new Map(passages.map((passage) => [passage.id, passage]));
	const proposals: Proposal[] = [];
	const notes: WritingNote[] = [];

	for (const suggestion of suggestions) {
		const passage = suggestion.passageId ? byId.get(suggestion.passageId) : undefined;
		const rewrite = suggestion.rewrite?.trim();

		if (passage && rewrite && rewrite !== passage.text) {
			proposals.push({
				id: `w${proposals.length + 1}`,
				target: passage.target,
				location: passage.location,
				before: passage.html,
				after: replaceBlockText(passage.html, rewrite),
				why: suggestion.issue,
				status: "pending",
				source: "check",
			});
			continue;
		}

		notes.push({
			location: passage?.location ?? suggestion.section ?? "",
			impact: suggestion.impact,
			quote: passage?.text ?? "",
			note: suggestion.issue,
			target: passage ? toPageTarget(passage.target) : null,
		});
	}

	return { proposals, notes };
}
