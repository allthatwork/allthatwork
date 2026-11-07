import type { Application } from "./types";
import type { ApplicationSort } from "@reactive-resume/schema/applications/filters";
import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@lingui/core";
import { APPLICATION_SORT_KEYS, defaultSortDirection } from "@reactive-resume/schema/applications/filters";
import { appliedDate, getDirectionOptions, sortApplications } from "./sort";

const NOW = new Date("2026-11-06T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const daysAhead = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

type Row = Pick<
	Application,
	| "id"
	| "role"
	| "company"
	| "status"
	| "activity"
	| "appliedAt"
	| "createdAt"
	| "updatedAt"
	| "followUpAt"
	| "followUpNote"
	| "searchFit"
	| "targetingFit"
>;

let next = 0;
const row = (patch: Partial<Row> = {}): Row => ({
	id: `app-${++next}`,
	role: "Engineer",
	company: "Harbor",
	status: "applied",
	activity: [],
	appliedAt: daysAgo(3),
	createdAt: daysAgo(3),
	updatedAt: daysAgo(3),
	followUpAt: null,
	followUpNote: null,
	searchFit: null,
	targetingFit: null,
	...patch,
});

const order = (rows: Row[], sort: ApplicationSort) => sortApplications(rows, sort).map((item) => item.id);

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("sortApplications", () => {
	it("sorts by updated, added and applied dates", () => {
		const a = row({ id: "a", updatedAt: daysAgo(1), createdAt: daysAgo(9), appliedAt: daysAgo(5) });
		const b = row({ id: "b", updatedAt: daysAgo(4), createdAt: daysAgo(2), appliedAt: daysAgo(1) });
		const c = row({ id: "c", updatedAt: daysAgo(2), createdAt: daysAgo(6), appliedAt: daysAgo(8) });
		expect(order([a, b, c], { sort: "updated", dir: "desc" })).toEqual(["a", "c", "b"]);
		expect(order([a, b, c], { sort: "updated", dir: "asc" })).toEqual(["b", "c", "a"]);
		expect(order([a, b, c], { sort: "added", dir: "desc" })).toEqual(["b", "c", "a"]);
		expect(order([a, b, c], { sort: "applied", dir: "desc" })).toEqual(["b", "a", "c"]);
	});

	it("puts blanks last in both directions", () => {
		const high = row({ id: "high", searchFit: 95 });
		const none = row({ id: "none", searchFit: null });
		const low = row({ id: "low", searchFit: 80 });
		expect(order([none, low, high], { sort: "fit", dir: "desc" })).toEqual(["high", "low", "none"]);
		expect(order([none, low, high], { sort: "fit", dir: "asc" })).toEqual(["low", "high", "none"]);

		const saved = row({ id: "saved", status: "saved" });
		const sent = row({ id: "sent", status: "applied", appliedAt: daysAgo(2) });
		expect(order([saved, sent], { sort: "applied", dir: "asc" })).toEqual(["sent", "saved"]);
		expect(order([saved, sent], { sort: "applied", dir: "desc" })).toEqual(["sent", "saved"]);
	});

	it("sorts by targeting fit", () => {
		const a = row({ id: "a", targetingFit: 60 });
		const b = row({ id: "b", targetingFit: 85 });
		const c = row({ id: "c" });
		expect(order([a, b, c], { sort: "tfit", dir: "desc" })).toEqual(["b", "a", "c"]);
	});

	it("sorts by the next interview or follow-up, soonest first, with no date last", () => {
		const later = row({ id: "later", status: "screening", followUpAt: daysAhead(5) });
		const sooner = row({ id: "sooner", status: "screening", followUpAt: daysAhead(1) });
		const waiting = row({ id: "waiting", status: "applied" });
		expect(order([waiting, later, sooner], { sort: "next", dir: "asc" })).toEqual(["sooner", "later", "waiting"]);
		expect(order([waiting, later, sooner], { sort: "next", dir: "desc" })).toEqual(["later", "sooner", "waiting"]);
	});

	it("sorts role and company A to Z ignoring case, with ties by role then company", () => {
		const a = row({ id: "a", role: "staff engineer", company: "Zeta" });
		const b = row({ id: "b", role: "Architect", company: "Beta" });
		const c = row({ id: "c", role: "Staff Engineer", company: "Alpha" });
		expect(order([a, b, c], { sort: "role", dir: "asc" })).toEqual(["b", "c", "a"]);
		expect(order([a, b, c], { sort: "company", dir: "asc" })).toEqual(["c", "b", "a"]);
		expect(order([a, b, c], { sort: "company", dir: "desc" })).toEqual(["a", "b", "c"]);
	});

	it("breaks ties by role so the order is stable", () => {
		const a = row({ id: "a", role: "Zed", searchFit: 90 });
		const b = row({ id: "b", role: "Ann", searchFit: 90 });
		expect(order([a, b], { sort: "fit", dir: "desc" })).toEqual(["b", "a"]);
		expect(order([a, b], { sort: "fit", dir: "asc" })).toEqual(["b", "a"]);
	});
});

describe("appliedDate", () => {
	it("has no date for Saved and for closed ones that never got past Saved", () => {
		expect(appliedDate(row({ status: "saved" }))).toBeNull();
		expect(
			appliedDate(
				row({
					status: "closed",
					activity: [
						{ id: "s1", type: "stage", stage: "saved", at: daysAgo(4) },
						{ id: "s2", type: "stage", stage: "closed", at: daysAgo(2) },
					],
				}),
			),
		).toBeNull();
	});

	it("uses the applied date for the rest, closed ones without a timeline included", () => {
		const at = daysAgo(6);
		expect(appliedDate(row({ status: "interview", appliedAt: at }))).toEqual(at);
		expect(appliedDate(row({ status: "closed", appliedAt: at }))).toEqual(at);
		expect(
			appliedDate(
				row({
					status: "closed",
					appliedAt: at,
					activity: [
						{ id: "s1", type: "stage", stage: "applied", at },
						{ id: "s2", type: "stage", stage: "closed", at: daysAgo(1) },
					],
				}),
			),
		).toEqual(at);
	});
});

describe("getDirectionOptions", () => {
	it("starts every key in its default direction", () => {
		for (const key of APPLICATION_SORT_KEYS) expect(getDirectionOptions(key)[0]?.dir).toBe(defaultSortDirection(key));
	});

	it("words the directions for the field", () => {
		expect(getDirectionOptions("added").map((option) => option.label)).toEqual(["Newest first", "Oldest first"]);
		expect(getDirectionOptions("fit").map((option) => option.label)).toEqual(["Highest first", "Lowest first"]);
		expect(getDirectionOptions("next").map((option) => option.label)).toEqual(["Soonest first", "Latest first"]);
		expect(getDirectionOptions("company").map((option) => option.label)).toEqual(["A to Z", "Z to A"]);
	});
});
