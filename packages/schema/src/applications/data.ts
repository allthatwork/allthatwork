import z from "zod";
import { timezoneSchema } from "@reactive-resume/utils/timezone";

// Canonical workflow categories stay fixed; user-owned lanes map to these categories.
// `closed` is the terminal stage, with a reason; it replaced the old `rejected` stage and the `archived` flag.
export const APPLICATION_STATUSES = ["saved", "applied", "screening", "interview", "offer", "closed"] as const;

export const applicationStatusSchema = z.enum(APPLICATION_STATUSES);

export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

/** How the bounded posting snapshot was obtained; retrieval time is not an origin freshness claim. */
export const postingSourceSchema = z.object({
	method: z.enum(["paste", "builtin", "firecrawl", "tavily", "exa"]),
	format: z.enum(["text", "markdown"]),
	requestedUrl: z.url({ protocol: /^https?$/ }).optional(),
	resolvedUrl: z.url({ protocol: /^https?$/ }).optional(),
	retrievedAt: z.iso.datetime({ offset: true }).optional(),
	providerFetchedAt: z.iso.datetime({ offset: true }).optional(),
	truncated: z.boolean(),
	completeness: z.enum(["unknown", "incomplete"]),
	/** The posting's language (BCP-47), from the page or its structured data; never guessed from the interface. */
	language: z.string().max(35).optional(),
	fallbackReason: z
		.enum([
			"unsafe-url",
			"unreachable",
			"not-a-page",
			"too-large",
			"auth",
			"quota",
			"malformed",
			"empty",
			"challenge",
			"timeout",
			"unavailable",
			"rate-limit",
		])
		.optional(),
});

export type PostingSource = z.infer<typeof postingSourceSchema>;

export const applicationClosedReasonSchema = z.enum([
	"accepted",
	"not-selected",
	"withdrew",
	"accepted-other",
	"no-response",
]);

/** Where building the targeted resume package stands; null when not queued or built. */
export const TARGETING_BUILD_STATUSES = ["build", "building", "built", "failed"] as const;
export const targetingBuildStatusSchema = z.enum(TARGETING_BUILD_STATUSES);
export type TargetingBuildStatus = z.infer<typeof targetingBuildStatusSchema>;

/**
 * One reviewer's read of a targeted resume in one review round: its fit and whether it would schedule a call, or why
 * it was skipped. The targeting fit is the median of the latest round's reviewers that ran.
 */
export const targetingReviewSchema = z.object({
	round: z.number().int().min(1).max(99),
	/** The reviewer's slot, such as A or B. */
	reviewer: z.string().trim().min(1).max(40),
	model: z.string().max(200).default(""),
	status: z.enum(["ran", "skipped"]).default("ran"),
	fit: z.number().int().min(0).max(100).nullable().default(null),
	/** Would they schedule a call, in their words. */
	verdict: z.string().max(1000).default(""),
	/** Why a skipped reviewer didn't run. */
	reason: z.string().max(1000).nullable().default(null),
});
export type TargetingReview = z.infer<typeof targetingReviewSchema>;

/** The median fit of the latest round's reviewers that ran, rounded; null without one. */
export function targetingFitOf(reviews: readonly TargetingReview[]): number | null {
	const latest = Math.max(0, ...reviews.map((review) => review.round));
	const fits = reviews
		.filter((review) => review.round === latest && review.status === "ran" && review.fit !== null)
		.map((review) => review.fit as number)
		.sort((a, b) => a - b);
	if (fits.length === 0) return null;
	const middle = Math.floor(fits.length / 2);
	const median =
		fits.length % 2 ? (fits[middle] as number) : ((fits[middle - 1] as number) + (fits[middle] as number)) / 2;
	return Math.round(median);
}

/** Where a question from targeting stands: still to answer, answered (with the fact it saved), or set aside. */
export const targetingQuestionStatusSchema = z.enum(["open", "answered", "dismissed"]);
export type TargetingQuestionStatus = z.infer<typeof targetingQuestionStatusSchema>;

/**
 * A question targeting the resume left for the user: evidence the build looked for and couldn't find in Knowledge,
 * with a proposed fact to confirm or complete (its `<placeholders>` are the blanks) and the Knowledge group it belongs
 * in. Answering saves a fact; the build reads Knowledge, so it stops asking.
 */
export const targetingQuestionSchema = z.object({
	id: z.string().trim().min(1).max(100),
	/**
	 * What the question is about, as a short stable key such as `intact/t-cloud-outcome`. Questions with the same topic
	 * on different applications are one question: answering it closes them all, and a topic already answered isn't
	 * asked again.
	 */
	topic: z.string().trim().min(1).max(100).nullable().default(null),
	question: z.string().trim().min(1).max(4000),
	proposedFact: z.string().max(4000).default(""),
	/** What the record does and doesn't establish, so the answer doesn't overclaim. */
	boundary: z.string().max(4000).default(""),
	/** The Knowledge group the answer goes into, such as `professional-experience/acme/achievements`. */
	factGroup: z.string().max(200).nullable().default(null),
	status: targetingQuestionStatusSchema.default("open"),
	/** The fact text saved, or why it was set aside. */
	answer: z.string().max(4000).nullable().default(null),
	/** The Knowledge fact the answer saved, if any. */
	factId: z.string().max(255).nullable().default(null),
	answeredAt: z.iso.datetime({ offset: true }).nullable().default(null),
	/** The application where it was answered or set aside, when that was another one with the same topic. */
	answeredOn: z
		.object({ applicationId: z.string().max(255), company: z.string().max(500) })
		.nullable()
		.default(null),
});
export type TargetingQuestion = z.infer<typeof targetingQuestionSchema>;

/** Found by, for applications tracked from the app's own job search. */
export const FOUND_BY_IN_APP_SEARCH = "In-app search";

export type ApplicationClosedReason = z.infer<typeof applicationClosedReasonSchema>;

// Ordered stage metadata shared by the API (validation) and the web board (columns/colors). Colours are the design
// system's stage tokens, not a palette of their own, so every surface (board, list, Insights and its exported PNG)
// reads the same stage colour and follows the theme.
export const STAGES = [
	{ value: "saved", label: "Saved", color: "var(--stage-saved)" },
	{ value: "applied", label: "Applied", color: "var(--stage-applied)" },
	{ value: "screening", label: "Screening", color: "var(--stage-screening)" },
	{ value: "interview", label: "Interview", color: "var(--stage-interview)" },
	{ value: "offer", label: "Offer", color: "var(--stage-offer)" },
	{ value: "closed", label: "Closed", color: "var(--stage-closed)" },
] as const satisfies ReadonlyArray<{ value: ApplicationStatus; label: string; color: string }>;

export const contactSchema = z.object({
	contactId: z.string().min(1).optional(),
	name: z.string().trim().min(1),
	/** A new person's name parts, for the Directory contact made from this link; the saved link keeps only `name`. */
	firstName: z.string().trim().max(200).optional(),
	lastName: z.string().trim().max(200).optional(),
	role: z.string().trim().default(""),
	// Free-form label shown as a pill: "Recruiter", "Referral", "Hiring Manager"…
	type: z.string().trim().default(""),
	email: z
		.string()
		.trim()
		.refine((value) => value === "" || z.email().safeParse(value).success, "Invalid email address.")
		.default(""),
	phone: z.string().trim().default(""),
});

export type Contact = z.infer<typeof contactSchema>;

const timelineBaseSchema = z.object({
	id: z.string().min(1),
	at: z.coerce.date(),
});

export const interviewKindSchema = z.enum(["screening", "technical", "behavioral", "onsite", "other"]);

export type InterviewKind = z.infer<typeof interviewKindSchema>;

// Colours are the design system's stage tokens (CSS custom properties), not a palette of their own.
export const INTERVIEW_KINDS = [
	{ value: "screening", label: "Screening", color: "var(--stage-screening)" },
	{ value: "technical", label: "Technical", color: "var(--stage-applied)" },
	{ value: "behavioral", label: "Behavioral", color: "var(--stage-interview)" },
	{ value: "onsite", label: "Onsite", color: "var(--stage-offer)" },
	{ value: "other", label: "Other", color: "var(--ink-3)" },
] as const satisfies ReadonlyArray<{ value: InterviewKind; label: string; color: string }>;

export const interviewParticipantSchema = z.object({
	contactId: z.string().min(1).optional(),
	name: z.string().trim().min(1).max(200),
	/** A new person's name parts, for the Directory contact made from this link; the saved link keeps only `name`. */
	firstName: z.string().trim().max(200).optional(),
	lastName: z.string().trim().max(200).optional(),
	role: z.string().trim().max(200).default(""),
	profileUrl: z
		.url({ protocol: /^https$/ })
		.max(2048)
		.refine((value) => {
			try {
				const url = new URL(value);
				const host = url.hostname.toLowerCase().replace(/\.$/, "");
				// Public hostnames only; the web reader also validates DNS and redirects before fetching.
				return (
					!url.username &&
					!url.password &&
					host.includes(".") &&
					!/^[\d.]+$/.test(host) &&
					!host.includes(":") &&
					!/(?:^|\.)(?:localhost|local|internal|lan)$/.test(host) &&
					!host.endsWith(".home.arpa")
				);
			} catch {
				return false;
			}
		}, "Use a public HTTPS profile URL.")
		.optional(),
});

export const interviewAudienceSchema = z.enum(["recruiter", "hiring-manager", "practitioner", "panel", "other"]);

export const interviewTimezoneSchema = z
	.string()
	.trim()
	.min(1)
	.max(100)
	// Modern Intl accepts offsets such as "+05:00"; interviews need a named zone.
	.refine((value) => !/^[+-]/.test(value) && timezoneSchema.safeParse(value).success, "Choose a valid IANA timezone.");

// Interview details editable by the user. `at` on the timeline entry is the scheduled start
// (full timestamp, unlike stage/note entries which are day-granular).
export const interviewDetailsSchema = z.object({
	kind: interviewKindSchema,
	durationMinutes: z
		.number()
		.int()
		.min(5)
		.max(24 * 60)
		.default(60),
	location: z.string().trim().max(500).default(""),
	notes: z.string().trim().max(5000).default(""),
	participants: z.array(interviewParticipantSchema).max(20).default([]),
	audience: interviewAudienceSchema.default("other"),
	timezone: interviewTimezoneSchema.default("UTC"),
});

export type InterviewDetails = z.infer<typeof interviewDetailsSchema>;

export const applicationTimelineEntrySchema = z.discriminatedUnion("type", [
	timelineBaseSchema.extend({
		type: z.literal("stage"),
		stage: applicationStatusSchema,
		laneId: z.string().optional(),
		laneLabel: z.string().max(80).nullable().optional(),
		closedReason: applicationClosedReasonSchema.nullable().optional(),
		canonicalTransition: z.boolean().optional(),
		/** Imported state with no known entry date; `at` records the import, not the stage transition. */
		dateUnknown: z.boolean().optional(),
		/** Server-assigned write order, independent of the editable display date. Absent on legacy entries. */
		writeSequence: z.number().int().positive().optional(),
	}),
	timelineBaseSchema.extend({
		type: z.literal("note"),
		text: z.string().trim().min(1),
		/** Structured contact, scoped to this canonical stage visit; text remains readable by older clients. */
		followedUp: z
			.object({ stageEntryId: z.string().min(1).nullable(), kind: z.literal("reply").optional() })
			.optional(),
	}),
	timelineBaseSchema.extend({
		type: z.literal("interview"),
		...interviewDetailsSchema.shape,
	}),
]);

export type ApplicationTimelineEntry = z.infer<typeof applicationTimelineEntrySchema>;
export type InterviewTimelineEntry = Extract<ApplicationTimelineEntry, { type: "interview" }>;

/**
 * Latest stage write, independent of display dates and API timeline sorting. Sequenced writes supersede legacy
 * entries; a legacy-only history keeps its date-based fallback until its next move.
 */
export function latestStageEntryId(
	activity: readonly (Pick<ApplicationTimelineEntry, "id" | "type" | "at"> & { writeSequence?: number | undefined })[],
): string | null {
	let latest: (typeof activity)[number] | undefined;
	for (const entry of activity)
		if (
			entry.type === "stage" &&
			(!latest ||
				(entry.writeSequence ?? 0) > (latest.writeSequence ?? 0) ||
				(entry.writeSequence === undefined &&
					latest.writeSequence === undefined &&
					new Date(entry.at).getTime() >= new Date(latest.at).getTime()))
		)
			latest = entry;
	return latest?.id ?? null;
}

// Reserved for AI enrichment output (autofill / match-score). Free-form so the shape can
// evolve without a migration. See the AI roadmap in the applications feature.
export const aiMetadataSchema = z.record(z.string(), z.unknown());

export type AiMetadata = z.infer<typeof aiMetadataSchema>;

/** Active post-submission stages confirm sending; closing a saved job alone does not. */
export function hasApplicationSubmission(application: {
	status: ApplicationStatus;
	activity: readonly ApplicationTimelineEntry[];
}): boolean {
	const sent = (status: ApplicationStatus) => status !== "saved" && status !== "closed";
	return (
		sent(application.status) ||
		(application.status === "closed" &&
			application.activity.some(
				(entry) => entry.type === "stage" && entry.canonicalTransition !== false && sent(entry.stage),
			))
	);
}

const INTERVIEW_SEQUENCE: readonly InterviewKind[] = ["screening", "technical", "behavioral", "onsite"];

/**
 * The type a new interview most likely is: the step after the furthest one already on the timeline, or Other past an
 * onsite. With none yet, a screening, or a technical round once the application has moved to the Interview stage.
 */
export function nextInterviewKind(existing: readonly InterviewKind[], pastScreening = false): InterviewKind {
	const furthest = Math.max(-1, ...existing.map((kind) => INTERVIEW_SEQUENCE.indexOf(kind)));
	if (furthest === -1) return existing.length > 0 ? "other" : pastScreening ? "technical" : "screening";
	return INTERVIEW_SEQUENCE[furthest + 1] ?? "other";
}
