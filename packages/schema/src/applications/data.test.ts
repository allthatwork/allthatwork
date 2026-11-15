import type { ApplicationStatus, ApplicationTimelineEntry } from "./data";
import { describe, expect, it } from "vite-plus/test";
import {
	applicationTimelineEntrySchema,
	hasApplicationSubmission,
	latestStageEntryId,
	nextInterviewKind,
	TARGETING_BUILD_STATUSES,
	targetingBuildStatusSchema,
	targetingFitOf,
	targetingReviewSchema,
} from "./data";

const review = (round: number, reviewer: string, fit: number | null, status: "ran" | "skipped" = "ran") =>
	targetingReviewSchema.parse({ round, reviewer, fit, status });

describe("targetingFitOf", () => {
	it("is the median of the latest round's reviewers that ran", () => {
		expect(
			targetingFitOf([
				review(1, "A", 40),
				review(2, "A", 35),
				review(2, "B", 72),
				review(2, "C", 78),
				review(2, "D", null, "skipped"),
			]),
		).toBe(72);
	});

	it("averages the middle two of an even count and rounds", () => {
		expect(targetingFitOf([review(1, "B", 65), review(1, "C", 58)])).toBe(62);
		expect(targetingFitOf([review(1, "B", 55), review(1, "C", 55)])).toBe(55);
	});

	it("is null with no reviews, or when the latest round has no fit", () => {
		expect(targetingFitOf([])).toBeNull();
		expect(targetingFitOf([review(1, "B", 70), review(2, "A", null, "skipped")])).toBeNull();
	});
});

describe("targetingBuildStatusSchema", () => {
	it("accepts build, building, built and failed, and rejects unknown values", () => {
		for (const status of TARGETING_BUILD_STATUSES) {
			expect(targetingBuildStatusSchema.parse(status)).toBe(status);
		}
		expect(targetingBuildStatusSchema.safeParse("pending").success).toBe(false);
	});
});

const stage = (status: ApplicationStatus): Extract<ApplicationTimelineEntry, { type: "stage" }> => ({
	id: status,
	type: "stage",
	stage: status,
	at: new Date("2026-10-29T12:00:00Z"),
});

describe("confirmed application submission", () => {
	it("recognizes a submitted stage without documents or checklist ticks", () => {
		expect(hasApplicationSubmission({ status: "screening", activity: [] })).toBe(true);
	});
	it("preserves submission after closing, but never from closing a saved job or old history after returning", () => {
		expect(hasApplicationSubmission({ status: "closed", activity: [stage("saved"), stage("closed")] })).toBe(false);
		expect(
			hasApplicationSubmission({ status: "closed", activity: [stage("applied"), stage("interview"), stage("closed")] }),
		).toBe(true);
		expect(
			hasApplicationSubmission({ status: "closed", activity: [{ ...stage("applied"), canonicalTransition: false }] }),
		).toBe(false);
		expect(hasApplicationSubmission({ status: "saved", activity: [stage("applied"), stage("saved")] })).toBe(false);
	});
});

it("stage-write identity survives date edits, API sorting, legacy dates and same-clock moves", () => {
	const legacy = { ...stage("saved"), at: new Date("2099-01-01T12:00:00Z") };
	const first = { ...stage("applied"), writeSequence: 1 };
	const second = { ...stage("interview"), at: new Date("2026-10-29T08:00:00Z"), writeSequence: 2 };
	for (const entries of [
		[legacy, first, second],
		[second, first, legacy],
	]) {
		expect(latestStageEntryId(entries.map((entry) => applicationTimelineEntrySchema.parse(entry)))).toBe("interview");
	}
	expect(latestStageEntryId([legacy, { ...second, at: new Date("2020-01-01") }])).toBe("interview");
	expect(latestStageEntryId([stage("applied"), legacy])).toBe("saved");
});

describe("nextInterviewKind", () => {
	it("suggests the step after the furthest interview, then Other", () => {
		expect(nextInterviewKind([])).toBe("screening");
		expect(nextInterviewKind([], true)).toBe("technical");
		expect(nextInterviewKind(["screening"])).toBe("technical");
		expect(nextInterviewKind(["technical", "screening"])).toBe("behavioral");
		expect(nextInterviewKind(["onsite"])).toBe("other");
		expect(nextInterviewKind(["other"])).toBe("other");
	});
});
