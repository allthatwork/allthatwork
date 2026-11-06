import type { Application } from "./types";
import type { ApplicationFilters } from "@reactive-resume/schema/applications/filters";
import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@lingui/core";
import { DEFAULT_APPLICATION_FILTERS, OPEN_STAGES } from "@reactive-resume/schema/applications/filters";
import {
	activeFilterCount,
	attentionOf,
	clearFacet,
	facetOptions,
	filterApplications,
	isDefaultFilters,
	markTag,
	mergeSnapshot,
	optionCounts,
	sameFilters,
	snapshotOf,
	summary,
	toggleStage,
	valuesInUse,
	withHeld,
} from "./filter";

const NOW = new Date("2026-11-06T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const context = { now: NOW, noReplyDays: 10 };

let next = 0;
const app = (patch: Partial<Application> = {}): Application => ({
	id: `app-${++next}`,
	company: "Harbor",
	companyId: null,
	role: "Engineer",
	status: "saved",
	closedReason: null,
	coverLetterId: null,
	sentResumeVersionId: null,
	sentCoverLetterVersionId: null,
	sentCheckScore: null,
	requirements: [],
	location: null,
	salary: null,
	source: null,
	sourceUrl: null,
	notes: null,
	tags: [],
	contacts: [],
	activity: [],
	appliedAt: daysAgo(3),
	createdAt: daysAgo(3),
	updatedAt: daysAgo(3),
	resumeId: null,
	jobDescription: null,
	postingSource: null,
	matchScore: null,
	aiMetadata: null,
	resumeFileUrl: null,
	resumeFileName: null,
	coverLetterUrl: null,
	coverLetterName: null,
	followUpAt: null,
	followUpNote: null,
	foundBy: null,
	searchFit: null,
	searchNotes: null,
	searchAt: null,
	targetingBuildStatus: null,
	targetingNotes: null,
	targetingFit: null,
	targetingReviews: [],
	targetingPrimaryLane: null,
	targetingSecondaryLane: null,
	targetingAt: null,
	targetingQuestions: [],
	...patch,
});

const f = (patch: Partial<ApplicationFilters> = {}): ApplicationFilters => ({
	...DEFAULT_APPLICATION_FILTERS,
	stage: [...OPEN_STAGES],
	...patch,
});

const ids = (applications: Application[]) => applications.map((application) => application.id);
const run = (applications: Application[], filters: ApplicationFilters) =>
	ids(filterApplications(applications, filters, context));

const question = (status: "open" | "answered"): Application["targetingQuestions"][number] => ({
	id: `q-${++next}`,
	topic: null,
	question: "Which observability stack did you run?",
	proposedFact: "I ran <stack> at scale.",
	boundary: "",
	factGroup: null,
	status,
	answer: null,
	factId: null,
	answeredAt: null,
	answeredOn: null,
});

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});

describe("each filter on its own", () => {
	it("search reads role, company, location, contacts and tags", () => {
		const a = app({ role: "Staff SRE" });
		const b = app({ contacts: [{ name: "Dana Reyes", role: "", type: "recruiter", email: "", phone: "" }] });
		const c = app({ tags: ["remote"] });
		const d = app({ location: "Lisbon" });
		const all = [a, b, c, d];
		expect(run(all, f({ q: "  sre " }))).toEqual([a.id]);
		expect(run(all, f({ q: "reyes" }))).toEqual([b.id]);
		expect(run(all, f({ q: "remote" }))).toEqual([c.id]);
		expect(run(all, f({ q: "lisbon" }))).toEqual([d.id]);
	});

	it("stage defaults to the open stages", () => {
		const saved = app();
		const closed = app({ status: "closed" });
		expect(run([saved, closed], f())).toEqual([saved.id]);
		expect(run([saved, closed], f({ stage: ["closed"] }))).toEqual([closed.id]);
	});

	it("build matches the status, with none for not queued", () => {
		const none = app();
		const built = app({ targetingBuildStatus: "built" });
		const queued = app({ targetingBuildStatus: "build" });
		expect(run([none, built, queued], f({ build: ["none"] }))).toEqual([none.id]);
		expect(run([none, built, queued], f({ build: ["built", "build"] }))).toEqual([built.id, queued.id]);
	});

	it("found by and found on match ignoring case, with none for not set", () => {
		const dorel = app({ foundBy: "Dorel", source: "Greenhouse" });
		const unset = app({ foundBy: "  ", source: null });
		expect(run([dorel, unset], f({ foundBy: ["dorel"] }))).toEqual([dorel.id]);
		expect(run([dorel, unset], f({ foundBy: ["none"] }))).toEqual([unset.id]);
		expect(run([dorel, unset], f({ source: ["Greenhouse"] }))).toEqual([dorel.id]);
		expect(run([dorel, unset], f({ source: ["none"] }))).toEqual([unset.id]);
	});

	it("lanes match either lane, or the primary only, and none means no primary lane", () => {
		const primary = app({ targetingPrimaryLane: "Platform" });
		const secondary = app({ targetingPrimaryLane: "AI agents", targetingSecondaryLane: "Platform" });
		const none = app();
		const all = [primary, secondary, none];
		expect(run(all, f({ lane: ["Platform"] }))).toEqual([primary.id, secondary.id]);
		expect(run(all, f({ lane: ["Platform"], laneMode: "primary" }))).toEqual([primary.id]);
		expect(run(all, f({ lane: ["none"] }))).toEqual([none.id]);
		expect(run(all, f({ lane: ["none"], laneMode: "primary" }))).toEqual([none.id]);
	});

	it("fit thresholds are at least that, and none finds the ones without", () => {
		const high = app({ searchFit: 90, targetingFit: 72 });
		const edge = app({ searchFit: 85, targetingFit: null });
		const low = app({ searchFit: 80 });
		const none = app();
		const all = [high, edge, low, none];
		expect(run(all, f({ fit: "85" }))).toEqual([high.id, edge.id]);
		expect(run(all, f({ fit: "none" }))).toEqual([none.id]);
		expect(run(all, f({ tfit: "70" }))).toEqual([high.id]);
		expect(run(all, f({ tfit: "none" }))).toEqual([edge.id, low.id, none.id]);
	});

	it("documents count a linked resume or file, and a letter or letter file", () => {
		const resume = app({ resumeId: "r" });
		const file = app({ resumeFileUrl: "https://files.example/r.pdf" });
		const letter = app({ coverLetterUrl: "https://files.example/l.pdf" });
		const all = [resume, file, letter];
		expect(run(all, f({ resume: "linked" }))).toEqual([resume.id, file.id]);
		expect(run(all, f({ resume: "none" }))).toEqual([letter.id]);
		expect(run(all, f({ letter: "linked" }))).toEqual([letter.id]);
		expect(run(all, f({ letter: "none" }))).toEqual([resume.id, file.id]);
	});

	it("attention finds late replies, due follow-ups, interviews and open questions", () => {
		const noReply = app({ status: "applied", appliedAt: daysAgo(12) });
		const waiting = app({ status: "applied", appliedAt: daysAgo(2) });
		const followUp = app({ status: "screening", followUpAt: daysAgo(1) });
		const laterFollowUp = app({ status: "screening", followUpAt: daysAgo(-3) });
		const interview = app({
			status: "interview",
			activity: [
				{
					id: "i",
					type: "interview",
					at: daysAgo(-2),
					kind: "technical",
					durationMinutes: 60,
				} as Application["activity"][number],
			],
		});
		const questions = app({ targetingQuestions: [question("open")] });
		const answered = app({ targetingQuestions: [question("answered")] });
		const all = [noReply, waiting, followUp, laterFollowUp, interview, questions, answered];

		expect(run(all, f({ attention: ["no-reply"] }))).toEqual([noReply.id]);
		expect(run(all, f({ attention: ["follow-up"] }))).toEqual([followUp.id]);
		expect(run(all, f({ attention: ["interview"] }))).toEqual([interview.id]);
		expect(run(all, f({ attention: ["questions"] }))).toEqual([questions.id]);
		expect(run(all, f({ attention: ["no-reply", "questions"] }))).toEqual([noReply.id, questions.id]);
		// Off in Preferences: no application is late.
		expect(attentionOf(noReply, { now: NOW, noReplyDays: 0 })).toEqual([]);
	});

	it("dates count days back from now", () => {
		const fresh = app({ createdAt: daysAgo(2), updatedAt: daysAgo(1) });
		const older = app({ createdAt: daysAgo(20), updatedAt: daysAgo(10) });
		const old = app({ createdAt: daysAgo(40), updatedAt: daysAgo(31) });
		const all = [fresh, older, old];
		expect(run(all, f({ added: "7" }))).toEqual([fresh.id]);
		expect(run(all, f({ added: "30" }))).toEqual([fresh.id, older.id]);
		expect(run(all, f({ updated: "14" }))).toEqual([fresh.id, older.id]);
		expect(run(all, f({ updated: "30" }))).toEqual([fresh.id, older.id]);
	});

	it("tags match exactly, ignoring case, any or all of them, and exclusion wins", () => {
		const remote = app({ tags: ["Remote"] });
		const both = app({ tags: ["remote", "referral"] });
		const agency = app({ tags: ["remote", "agency"] });
		const remotely = app({ tags: ["remotely"] });
		const all = [remote, both, agency, remotely];
		expect(run(all, f({ tag: ["remote"] }))).toEqual([remote.id, both.id, agency.id]);
		expect(run(all, f({ tag: ["remote", "referral"], tagMode: "all" }))).toEqual([both.id]);
		expect(run(all, f({ tag: ["referral", "agency"] }))).toEqual([both.id, agency.id]);
		expect(run(all, f({ tag: ["remote"], notTag: ["agency"] }))).toEqual([remote.id, both.id]);
		expect(run(all, f({ tag: ["agency"], notTag: ["agency"] }))).toEqual([]);
	});
});

it("combines filters with AND", () => {
	const match = app({ targetingBuildStatus: "built", foundBy: "Dorel", searchFit: 90 });
	const wrongBuild = app({ foundBy: "Dorel", searchFit: 90 });
	const wrongFit = app({ targetingBuildStatus: "built", foundBy: "Dorel", searchFit: 80 });
	const closed = app({ status: "closed", targetingBuildStatus: "built", foundBy: "Dorel", searchFit: 90 });
	const filters = f({ build: ["built"], foundBy: ["Dorel"], fit: "85" });
	expect(run([match, wrongBuild, wrongFit, closed], filters)).toEqual([match.id]);
});

describe("option counts", () => {
	it("apply every other filter, the search included, but not the facet's own", () => {
		const all = [
			app({ role: "SRE", foundBy: "Dorel", targetingBuildStatus: "built" }),
			app({ role: "SRE", foundBy: "Muse", targetingBuildStatus: "built" }),
			app({ role: "SRE", foundBy: "Dorel" }),
			app({ role: "Designer", foundBy: "Dorel", targetingBuildStatus: "built" }),
			app({ role: "SRE", foundBy: "Dorel", status: "closed", targetingBuildStatus: "built" }),
		];
		const filters = f({ q: "sre", build: ["built"], foundBy: ["Dorel"] });
		const byFoundBy = optionCounts(all, filters, "foundBy", context);
		expect(byFoundBy("Dorel")).toBe(1);
		expect(byFoundBy("muse")).toBe(1);
		expect(byFoundBy("GPT")).toBe(0);
		const byBuild = optionCounts(all, filters, "build", context);
		expect(byBuild("built")).toBe(1);
		expect(byBuild("none")).toBe(1);
		const byStage = optionCounts(all, filters, "stage", context);
		expect(byStage("saved")).toBe(1);
		expect(byStage("closed")).toBe(1);
	});

	it("count an application once per lane, in either mode", () => {
		const all = [
			app({ targetingPrimaryLane: "Platform", targetingSecondaryLane: "AI agents" }),
			app({ targetingPrimaryLane: "AI agents" }),
			app(),
		];
		const either = optionCounts(all, f(), "lane", context);
		expect([either("Platform"), either("AI agents"), either("none")]).toEqual([1, 2, 1]);
		const primary = optionCounts(all, f({ laneMode: "primary" }), "lane", context);
		expect([primary("Platform"), primary("AI agents"), primary("none")]).toEqual([1, 1, 1]);
	});
});

describe("options", () => {
	const all = [
		app({ foundBy: "Muse", targetingPrimaryLane: "Observability", tags: ["remote", "agency"] }),
		app({ foundBy: "Dorel", tags: ["remote"] }),
		app({ foundBy: "dorel" }),
		app(),
	];

	it("lists values in use, most used first, then Not set", () => {
		expect(valuesInUse(all, "foundBy")).toEqual(["Dorel", "Muse"]);
		expect(valuesInUse(all, "tags")).toEqual(["remote", "agency"]);
		const options = facetOptions("foundBy", { applications: all, filters: f({ foundBy: ["GPT"] }), context });
		expect(options.map((option) => [option.label, option.count])).toEqual([
			["Dorel", 2],
			["Muse", 1],
			["GPT", 0],
			["Not set", 1],
		]);
	});

	it("lists the Preferences lanes, then lanes in use, then No lane", () => {
		const options = facetOptions("lane", { applications: all, filters: f(), context, lanes: ["Platform"] });
		expect(options.map((option) => option.label)).toEqual(["Platform", "Observability", "No lane"]);
	});

	it("hides No reply when the reminder is off", () => {
		const on = facetOptions("attention", { applications: all, filters: f(), context });
		const off = facetOptions("attention", { applications: all, filters: f(), context: { now: NOW, noReplyDays: 0 } });
		expect(on.map((option) => option.label)).toEqual([
			"No reply in 10+ days",
			"Follow-up due",
			"Interview coming",
			"Questions to answer",
		]);
		expect(off.map((option) => option.value)).toEqual(["follow-up", "interview", "questions"]);
	});
});

describe("defaults and comparisons", () => {
	it("knows the default, the search included", () => {
		expect(isDefaultFilters(f())).toBe(true);
		expect(isDefaultFilters(f({ stage: ["offer", "interview", "screening", "applied", "saved"] }))).toBe(true);
		expect(isDefaultFilters(f({ q: "  " }))).toBe(true);
		expect(isDefaultFilters(f({ q: "sre" }))).toBe(false);
		expect(isDefaultFilters(f({ stage: ["saved"] }))).toBe(false);
	});

	it("counts set filters, not the search", () => {
		expect(activeFilterCount(f({ q: "sre" }))).toBe(0);
		expect(activeFilterCount(f({ stage: ["saved"], build: ["built"], fit: "85", tfit: "70" }))).toBe(3);
	});

	it("compares filters whatever the order of values", () => {
		expect(sameFilters(f({ foundBy: ["Dorel", "Muse"] }), f({ foundBy: ["muse", "Dorel"] }))).toBe(true);
		expect(sameFilters(f({ foundBy: ["Dorel"] }), f({ foundBy: ["Dorel", "Muse"] }))).toBe(false);
	});

	it("clears one filter, with its mode", () => {
		const filters = f({ lane: ["Platform"], laneMode: "primary", tag: ["a", "b"], tagMode: "all", fit: "90" });
		expect(clearFacet(filters, "lane")).toEqual(f({ tag: ["a", "b"], tagMode: "all", fit: "90" }));
		expect(clearFacet(filters, "tags")).toEqual(f({ lane: ["Platform"], laneMode: "primary", fit: "90" }));
		expect(clearFacet(f({ stage: ["closed"] }), "stage")).toEqual(f());
	});

	it("keeps stages in pipeline order and never empty", () => {
		expect(toggleStage(["offer"], "saved")).toEqual(["saved", "offer"]);
		expect(toggleStage(["saved"], "saved")).toEqual(["saved"]);
	});

	it("marks tags + and −, and the same mark again clears it", () => {
		const plus = markTag(f(), "remote", "in");
		expect([plus.tag, plus.notTag]).toEqual([["remote"], []]);
		const minus = markTag(plus, "remote", "out");
		expect([minus.tag, minus.notTag]).toEqual([[], ["remote"]]);
		expect(markTag(minus, "remote", "out").notTag).toEqual([]);
		// All of falls back to Any of once fewer than two + tags are left.
		const two = { ...markTag(markTag(f(), "a", "in"), "b", "in"), tagMode: "all" as const };
		expect(markTag(two, "b", "in").tagMode).toBe("any");
	});
});

describe("summary labels", () => {
	it("say what each button shows", () => {
		expect(summary(f(), "stage")).toBe("Open");
		expect(summary(f({ stage: ["saved", "applied", "screening", "interview", "offer", "closed"] }), "stage")).toBe(
			"All",
		);
		expect(summary(f({ stage: ["applied", "screening", "interview", "offer"] }), "stage")).toBe("Applied to Offer");
		expect(summary(f({ stage: ["saved"] }), "stage")).toBe("Saved");
		expect(summary(f({ stage: ["saved", "closed"] }), "stage")).toBe("Saved, Closed");
		expect(summary(f(), "build")).toBeNull();
		expect(summary(f({ build: ["built"] }), "build")).toBe("Built");
		expect(summary(f({ build: ["none", "build"] }), "build")).toBe("Not queued, Queued");
		expect(summary(f({ foundBy: ["Dorel", "Muse"] }), "foundBy")).toBe("Dorel, Muse");
		expect(summary(f({ foundBy: ["Dorel", "Muse", "none"] }), "foundBy")).toBe("3");
		expect(summary(f({ source: ["none"] }), "source")).toBe("Not set");
		expect(summary(f({ lane: ["none"] }), "lane")).toBe("No lane");
		expect(summary(f({ fit: "85" }), "fit")).toBe("Search 85+");
		expect(summary(f({ fit: "none", tfit: "70" }), "fit")).toBe("No search fit, Targeting 70+");
		expect(summary(f({ resume: "linked", letter: "none" }), "documents")).toBe("Resume, No letter");
		expect(summary(f({ attention: ["no-reply"] }), "attention", { noReplyDays: 14 })).toBe("No reply in 14+ days");
		expect(summary(f({ added: "7" }), "dates")).toBe("Added 7d");
		expect(summary(f({ tag: ["remote"], notTag: ["agency"] }), "tags")).toBe("#remote, not #agency");
	});
});

describe("cards changed while filtered", () => {
	it("stay on screen, under the stage they showed in, until the filters change", () => {
		const a = app({ id: "a" });
		const b = app({ id: "b" });
		const notQueued = f({ build: ["none"] });
		const matches = (application: Application) => application.targetingBuildStatus === null;

		// The filters change: the snapshot starts from what matches.
		const snapshot = snapshotOf([a, b]);

		// Build is ticked on a, and it's moved to Applied: it no longer matches but stays, under Saved.
		const changed = { ...a, targetingBuildStatus: "build" as const, status: "applied" as const };
		const held = withHeld([changed, b], matches, snapshot);
		expect(ids(held.shown)).toEqual(["a", "b"]);
		expect(ids(held.matching)).toEqual(["b"]);
		expect([...held.stale]).toEqual([["a", "saved"]]);
		expect(mergeSnapshot(snapshot, held.matching)).toBeNull();

		// The next filter change starts a new snapshot from what matches: a is gone.
		const fresh = mergeSnapshot(new Map(), filterApplications([changed, b], notQueued, context));
		expect(fresh && ids(withHeld([changed, b], matches, fresh).shown)).toEqual(["b"]);
	});

	it("keep their order when a change moves them to the top of the list", () => {
		const [a, b, c] = [app({ id: "a" }), app({ id: "b" }), app({ id: "c" })];
		const snapshot = mergeSnapshot(new Map(), [a, b, c]) ?? new Map();
		// b was just updated, so the list now has it first; a new application d arrives too.
		const d = app({ id: "d" });
		const changed = { ...b, targetingBuildStatus: "build" as const };
		const held = withHeld([d, changed, a, c], (application) => application.targetingBuildStatus === null, snapshot);
		expect(ids(held.shown)).toEqual(["d", "a", "b", "c"]);
		const merged = mergeSnapshot(snapshot, held.matching);
		expect(merged && [...merged.keys()]).toEqual(["d", "a", "b", "c"]);
	});

	it("adds what starts matching, so it's held too if it changes later", () => {
		const a = app({ id: "a" });
		const merged = mergeSnapshot(new Map(), [a]);
		expect(merged && [...merged]).toEqual([["a", "saved"]]);
		const held = withHeld([{ ...a, targetingBuildStatus: "built" }], () => false, merged ?? new Map());
		expect(ids(held.shown)).toEqual(["a"]);
	});
});
