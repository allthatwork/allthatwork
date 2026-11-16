import type { ApplicationStatus, ApplicationTimelineEntry } from "./data";
import { describe, expect, it } from "vite-plus/test";
import {
	applicationStageSince,
	compareNextStepSortKeys,
	getNextStep,
	needsAttention,
	nextStepSortKey,
} from "./next-step";
import { computeOutcomes } from "./outcomes";

const now = new Date("2026-10-31T12:00:00Z");
const event = (
	stage: ApplicationStatus,
	at: string,
	canonicalTransition = true,
): Extract<ApplicationTimelineEntry, { type: "stage" }> => ({
	id: at,
	type: "stage",
	stage,
	at: new Date(at),
	canonicalTransition,
});
const app = (id: string, stage: ApplicationStatus, at: string, laneAt: string) => {
	const activity: ApplicationTimelineEntry[] = [event(stage, at), event(stage, laneAt, false)];
	return { id, status: stage, appliedAt: new Date("2026-08-01"), activity, followUpAt: null, followUpNote: null };
};
const order = (rows: ReturnType<typeof app>[], direction: "asc" | "desc" = "asc") =>
	rows
		.toSorted((a, b) =>
			compareNextStepSortKeys(nextStepSortKey(a, now), nextStepSortKey(b, now), a.id, b.id, direction),
		)
		.map((row) => row.id);

it.each(["applied", "interview", "offer"] as const)(
	"lane-only moves preserve the %s clock and stage ordering",
	(status) => {
		const a = app("A", status, "2026-10-01", "2026-10-30");
		const b = app("B", status, "2026-10-21", "2026-10-21");
		expect(order([b, a])).toEqual(["A", "B"]);
		expect(applicationStageSince(a)).toEqual(new Date("2026-10-01"));
		expect(getNextStep(a, now)).toMatchObject({ days: 30 });
		if (status === "applied") expect(getNextStep(a, now).kind).toBe("no-reply");
		a.activity[0] = event(status, "2026-10-25");
		expect(order([a, b])).toEqual(["B", "A"]);
	},
);

it("uses latest canonical re-entry, legacy entries, and appliedAt only when no canonical history exists", () => {
	const a = app("A", "offer", "2026-10-01", "2026-10-30");
	a.activity.push(event("offer", "2026-10-26"));
	expect(applicationStageSince(a)).toEqual(new Date("2026-10-26"));
	a.activity = [{ id: "legacy", type: "stage", stage: "offer", at: new Date("2026-10-09") }];
	expect(applicationStageSince(a)).toEqual(new Date("2026-10-09"));
	a.activity = [event("offer", "2026-10-30", false)];
	expect(applicationStageSince(a)).toEqual(a.appliedAt);
});

it("ranks dated actions first, sorts their dates, and breaks equal keys by stable IDs in either direction", () => {
	const a = app("A", "offer", "2026-10-01", "2026-10-30");
	const b = app("B", "offer", "2026-10-01", "2026-10-21");
	expect(order([b, a])).toEqual(["A", "B"]);
	expect(order([b, a], "desc")).toEqual(["A", "B"]);
	const dated = { ...b, followUpAt: new Date("2026-11-02") };
	expect(nextStepSortKey(dated, now)[0]).toBe(0);
	expect(nextStepSortKey(a, now)[0]).toBe(1);
	expect(compareNextStepSortKeys(nextStepSortKey(dated, now), nextStepSortKey(a, now), dated.id, a.id)).toBeLessThan(0);
	expect(compareNextStepSortKeys([0, 100], [0, 200], "B", "A")).toBeLessThan(0);
});

it("uses only the current Interview visit when deciding whether feedback is due", () => {
	const application = app("A", "interview", "2026-10-25", "2026-10-30");
	const interview: ApplicationTimelineEntry = {
		id: "interview",
		type: "interview",
		at: new Date("2026-10-20T10:00:00Z"),
		kind: "technical",
		durationMinutes: 60,
		location: "",
		notes: "",
		participants: [],
		audience: "practitioner",
		timezone: "UTC",
	};
	application.activity.push(interview);
	expect(getNextStep(application, now).kind).toBe("no-interview");
	application.activity.push({ ...interview, id: "current", at: new Date("2026-10-27T10:00:00Z") });
	expect(getNextStep(application, now).kind).toBe("interview-feedback");
});

it("orders offers by saved reply deadlines before undated decisions, preserving stage age", () => {
	const early = app("early", "offer", "2026-10-21", "2026-10-30");
	const late = app("late", "offer", "2026-10-01", "2026-10-30");
	const earlyHint = { respondBy: "2026-11-01T09:00:00Z" };
	const lateHint = { respondBy: "2026-11-03T09:00:00Z" };
	expect(nextStepSortKey(early, now, "Pacific/Honolulu", earlyHint)).toEqual([0, Date.parse(earlyHint.respondBy)]);
	expect(nextStepSortKey(late, now, "Pacific/Honolulu", lateHint)).toEqual([0, Date.parse(lateHint.respondBy)]);
	expect(
		compareNextStepSortKeys(
			nextStepSortKey(early, now, "UTC", earlyHint),
			nextStepSortKey(late, now, "UTC", lateHint),
			early.id,
			late.id,
		),
	).toBeLessThan(0);
	expect(nextStepSortKey(late, now, "UTC", null)).toEqual([1, Date.parse("2026-10-01")]);
	expect(getNextStep(early, now, "UTC", earlyHint)).toMatchObject({ kind: "offer", days: 10 });
});

it("nudges after silence following the last interview, counted from its end", () => {
	const interview = (at: string): ApplicationTimelineEntry =>
		({
			id: `i-${at}`,
			type: "interview",
			at: new Date(at),
			durationMinutes: 60,
			kind: "technical",
		}) as ApplicationTimelineEntry;
	const quiet = {
		...app("A", "interview", "2026-10-01", "2026-10-01"),
		activity: [event("interview", "2026-10-01"), interview("2026-10-05T10:00:00Z")],
	};
	expect(getNextStep(quiet, now)).toMatchObject({ kind: "no-reply", after: "interview", days: 26 });
	const recent = { ...quiet, activity: [event("interview", "2026-10-01"), interview("2026-10-28T10:00:00Z")] };
	expect(getNextStep(recent, now).kind).toBe("interview-feedback");
});

it("keeps an undated imported stage out of elapsed-time and no-reply claims", () => {
	const application = {
		status: "applied" as const,
		appliedAt: new Date("2026-01-01"),
		followUpAt: null,
		followUpNote: null,
		activity: [
			{
				id: "imported",
				type: "stage" as const,
				stage: "applied" as const,
				at: new Date("2026-01-01"),
				dateUnknown: true,
			},
		],
	};
	expect(applicationStageSince(application)).toBeNull();
	expect(getNextStep(application, new Date("2026-10-01"))).toEqual({ kind: "waiting", days: null });
});

const contact = (at: string, stageEntryId: string | null): ApplicationTimelineEntry => ({
	id: `contact-${at}`,
	type: "note",
	text: "Followed up",
	at: new Date(at),
	followedUp: { stageEntryId },
});

it("followed-up contact resets applied silence, preserving stage age and outcomes", () => {
	const application = { ...app("A", "applied", "2026-10-01", "2026-10-30"), resumeId: null, closedReason: null };
	const before = computeOutcomes([application], () => false);
	application.activity.push({ id: "plain", type: "note", text: "Followed up", at: now });
	expect(getNextStep(application, now)).toMatchObject({ kind: "no-reply", days: 30 });
	application.activity.push(contact("2026-10-25T12:00:00Z", "2026-10-01"));
	expect(getNextStep(application, now)).toEqual({ kind: "waiting", days: 30 });
	expect(getNextStep(application, new Date("2026-11-04T12:00:00Z"))).toEqual({ kind: "no-reply", days: 10 });
	expect(applicationStageSince(application)).toEqual(new Date("2026-10-01"));
	expect(computeOutcomes([application], () => false)).toEqual(before);
	expect(
		getNextStep({ ...application, followUpAt: new Date("2026-10-29"), followUpNote: "Keep reminder" }, now),
	).toMatchObject({ kind: "follow-up", note: "Keep reminder", overdue: true });
});

it("ignores future contact and contact from a prior visit, including backdated re-entry", () => {
	const application = app("A", "applied", "2026-10-01", "2026-10-30");
	application.activity.push(
		contact("2026-11-05T12:00:00Z", "2026-10-01"),
		contact("2026-10-25T12:00:00Z", "old-visit"),
	);
	expect(getNextStep(application, now)).toMatchObject({ kind: "no-reply", days: 30 });
	application.activity.push(contact("2026-10-25T12:00:00Z", "2026-10-01"));
	expect(getNextStep(application, now).kind).toBe("waiting");
	application.activity.push({ ...event("screening", "2026-10-05"), id: "other", writeSequence: 2 });
	application.activity.push({ ...event("applied", "2026-10-10"), id: "re-entry", writeSequence: 3 });
	expect(getNextStep(application, now)).toEqual({ kind: "no-reply", days: 21 });
});

it("dates silence from known contact without inventing an imported stage date", () => {
	const application = app("A", "applied", "2026-10-01", "2026-10-30");
	application.activity[0] = { ...event("applied", "2026-10-01"), dateUnknown: true };
	application.activity.push(contact("2026-10-20T12:00:00Z", "2026-10-01"));
	expect(applicationStageSince(application)).toBeNull();
	expect(getNextStep(application, now)).toEqual({ kind: "no-reply", days: 11 });
});

it("uses the contact instant even before a whole-day stage's noon marker, but not a prior day's contact", () => {
	const application = app("A", "applied", "2026-10-20T12:00:00Z", "2026-10-20T12:00:00Z");
	application.activity.push(contact("2026-10-19T08:00:00Z", "2026-10-20T12:00:00Z"));
	expect(getNextStep(application, new Date("2026-10-30T08:00:00Z"))).toEqual({ kind: "waiting", days: 9 });
	application.activity.push(contact("2026-10-20T08:00:00Z", "2026-10-20T12:00:00Z"));
	expect(getNextStep(application, new Date("2026-10-30T08:00:00Z"))).toEqual({ kind: "no-reply", days: 10 });
});

it.each(["applied", "interview"] as const)(
	"uses the written %s visit for silence after a backdated re-entry",
	(status) => {
		const application = app("A", status, "2026-10-20", "2026-10-30");
		application.activity[0] = { ...event(status, "2026-10-20"), writeSequence: 1 };
		application.activity.push(
			{ ...event("screening", "2026-10-01"), id: "between", writeSequence: 2 },
			{ ...event(status, "2026-10-05"), id: "current-visit", writeSequence: 3 },
		);
		if (status === "interview")
			application.activity.push({
				id: "current-round",
				type: "interview",
				at: new Date("2026-10-06T11:00:00Z"),
				durationMinutes: 60,
				kind: "technical",
				location: "",
				notes: "",
				participants: [],
				audience: "other",
				timezone: "UTC",
			});
		expect(getNextStep(application, now)).toMatchObject({ kind: "no-reply", days: status === "interview" ? 25 : 26 });
		application.activity.push(contact("2026-10-10T12:00:00Z", "current-visit"));
		expect(getNextStep(application, now)).toMatchObject({ kind: "no-reply", days: 21 });
		expect(applicationStageSince(application)).toEqual(new Date("2026-10-20"));
	},
);

it("keeps the latest contact without a function-argument limit on long histories", () => {
	const application = app("A", "applied", "2026-10-01", "2026-10-30");
	const older = contact("2026-10-05T12:00:00Z", "2026-10-01");
	application.activity = [
		...application.activity,
		contact("2026-10-25T12:00:00Z", "2026-10-01"),
		...Array.from({ length: 150_000 }, (_, index) => ({ ...older, id: `old-contact-${index}` })),
	];
	expect(getNextStep(application, now)).toEqual({ kind: "waiting", days: 30 });
});

it("counts interview silence from the later of its end and contact in this visit", () => {
	const application = app("A", "interview", "2026-10-01", "2026-10-30");
	application.activity.push({
		id: "i",
		type: "interview",
		at: new Date("2026-10-15T11:00:00Z"),
		durationMinutes: 60,
		kind: "technical",
	} as ApplicationTimelineEntry);
	application.activity.push(contact("2026-10-10T12:00:00Z", "2026-10-01"));
	expect(getNextStep(application, now)).toEqual({ kind: "no-reply", days: 16, after: "interview" });
	application.activity.push(contact("2026-10-25T12:00:00Z", "2026-10-01"));
	expect(getNextStep(application, now)).toEqual({ kind: "interview-feedback", days: 30 });
	expect(getNextStep(application, new Date("2026-11-04T12:00:00Z"))).toEqual({
		kind: "no-reply",
		days: 10,
		after: "interview",
	});
	application.activity.push({
		id: "upcoming",
		type: "interview",
		at: new Date("2026-11-02T11:00:00Z"),
		durationMinutes: 60,
		kind: "technical",
	} as ApplicationTimelineEntry);
	expect(getNextStep(application, now)).toMatchObject({ kind: "interview", interview: { id: "upcoming" } });
});

it("uses the account's no-reply days in place of the default ten, and 0 never suggests a follow-up", () => {
	const applied = app("A", "applied", "2026-10-19T12:00:00Z", "2026-10-19T12:00:00Z");
	expect(getNextStep(applied, now)).toEqual({ kind: "no-reply", days: 12 });
	expect(getNextStep(applied, now, "UTC", null, 14)).toEqual({ kind: "waiting", days: 12 });
	expect(getNextStep(applied, now, "UTC", null, 5)).toEqual({ kind: "no-reply", days: 12 });
	expect(getNextStep(applied, now, "UTC", null, 0)).toEqual({ kind: "waiting", days: 12 });

	const interviewed = app("B", "interview", "2026-10-01", "2026-10-01");
	interviewed.activity.push({
		id: "i",
		type: "interview",
		at: new Date("2026-10-15T11:00:00Z"),
		durationMinutes: 60,
		kind: "technical",
	} as ApplicationTimelineEntry);
	expect(getNextStep(interviewed, now, "UTC", null, 20)).toEqual({ kind: "interview-feedback", days: 30 });
	expect(getNextStep(interviewed, now, "UTC", null, 0)).toEqual({ kind: "interview-feedback", days: 30 });
	expect(getNextStep(interviewed, now, "UTC", null, 14)).toEqual({ kind: "no-reply", days: 16, after: "interview" });
});

describe("a saved job whose posting closes soon", () => {
	// 2026-10-31 12:00 UTC is 05:00 in Los Angeles: still the 31st there.
	const zone = "America/Los_Angeles";
	const saved = (closesAt: string | null, extra: object = {}) => ({
		...app("S", "saved", "2026-10-20", "2026-10-20"),
		closesAt,
		...extra,
	});

	it.each([
		["today", "2026-10-31T23:59:59Z", 0],
		["tomorrow", "2026-11-01T23:59:59Z", 1],
		["in 3 days", "2026-11-03T23:59:59Z", 3],
	])("flags a deadline %s", (_name, closesAt, days) => {
		const step = getNextStep(saved(closesAt), now, zone);
		expect(step).toEqual({ kind: "closing", at: new Date(closesAt), days });
		expect(needsAttention(step, now)).toBe(true);
		expect(nextStepSortKey(saved(closesAt), now, zone)).toEqual([0, new Date(closesAt).getTime()]);
	});

	it("leaves a deadline 4 days out, one already past, and a stored junk value alone", () => {
		expect(getNextStep(saved("2026-11-04T23:59:59Z"), now, zone).kind).toBe("not-applied");
		expect(getNextStep(saved("2026-10-31T11:00:00Z"), now, zone).kind).toBe("not-applied");
		expect(getNextStep(saved("2026-10-24T23:59:59Z"), now, zone).kind).toBe("not-applied");
		expect(getNextStep(saved("not a date"), now, zone).kind).toBe("not-applied");
		expect(getNextStep(saved(null), now, zone).kind).toBe("not-applied");
	});

	it("counts calendar days in the account's time zone", () => {
		// 23:00 UTC on Nov 1 is still Nov 1 in Los Angeles (today the 31st) but Nov 2 in Tokyo (today the 31st too).
		const late = saved("2026-11-01T23:00:00Z");
		expect(getNextStep(late, now, zone)).toMatchObject({ kind: "closing", days: 1 });
		expect(getNextStep(late, now, "Asia/Tokyo")).toMatchObject({ kind: "closing", days: 2 });
		expect(getNextStep(saved("2026-11-03T16:00:00Z"), now, "Asia/Tokyo").kind).toBe("not-applied");
		expect(getNextStep(saved("2026-11-03T16:00:00Z"), now, zone)).toMatchObject({ days: 3 });
		expect(getNextStep(saved("2026-11-01T23:00:00Z"), now, "Not/A_Zone")).toMatchObject({ days: 1 });
	});

	it("never flags an application past Saved", () => {
		for (const status of ["applied", "screening", "interview", "offer", "closed"] as const)
			expect(getNextStep({ ...saved("2026-11-01T23:59:59Z"), status }, now, zone).kind).not.toBe("closing");
	});

	it("lets an upcoming interview and a due follow-up win, and goes ahead of a follow-up that isn't due", () => {
		const interview: ApplicationTimelineEntry = {
			id: "i",
			type: "interview",
			kind: "phone",
			at: new Date("2026-11-02T17:00:00Z"),
			durationMinutes: 30,
			participants: [],
		} as unknown as ApplicationTimelineEntry;
		const withInterview = saved("2026-11-01T23:59:59Z");
		withInterview.activity = [...withInterview.activity, interview];
		expect(getNextStep(withInterview, now, zone).kind).toBe("interview");
		const due = saved("2026-11-01T23:59:59Z", { followUpAt: new Date("2026-10-31T20:00:00Z"), followUpNote: "Ping" });
		expect(getNextStep(due, now, zone).kind).toBe("follow-up");
		const later = saved("2026-11-01T23:59:59Z", { followUpAt: new Date("2026-11-10T20:00:00Z"), followUpNote: "" });
		expect(getNextStep(later, now, zone).kind).toBe("closing");
		// Once the posting has closed, the later follow-up is the next step again.
		expect(getNextStep(later, new Date("2026-11-02T12:00:00Z"), zone).kind).toBe("follow-up");
	});

	it("stops needing attention once the deadline passes", () => {
		const step = getNextStep(saved("2026-10-31T23:59:59Z"), now, zone);
		expect(needsAttention(step, new Date("2026-11-01T00:00:00Z"))).toBe(false);
	});
});
