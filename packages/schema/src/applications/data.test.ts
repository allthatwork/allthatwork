import type { ApplicationStatus, ApplicationTimelineEntry } from "./data";
import { describe, expect, it } from "vite-plus/test";
import {
	hasApplicationSubmission,
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
	it.each(["applied", "screening", "interview", "offer"] as const)(
		"recognizes %s without documents or checklist ticks",
		(status) => {
			expect(hasApplicationSubmission({ status, activity: [] })).toBe(true);
		},
	);
	it("preserves submission after closing, but never infers it from closing a saved job", () => {
		expect(hasApplicationSubmission({ status: "closed", activity: [stage("saved"), stage("closed")] })).toBe(false);
		expect(
			hasApplicationSubmission({ status: "closed", activity: [stage("applied"), stage("interview"), stage("closed")] }),
		).toBe(true);
		expect(
			hasApplicationSubmission({ status: "closed", activity: [{ ...stage("applied"), canonicalTransition: false }] }),
		).toBe(false);
	});
	it("allows a job to return to preparation without treating old history as a new submission", () => {
		expect(hasApplicationSubmission({ status: "saved", activity: [stage("applied"), stage("saved")] })).toBe(false);
	});
});
