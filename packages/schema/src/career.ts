import z from "zod";
import { searchRegionsSchema } from "@reactive-resume/utils/region";
import { timezoneSchema } from "@reactive-resume/utils/timezone";
import { aiOperationIdsSchema } from "./ai-usage";
import { applicationClosedReasonSchema, applicationStatusSchema } from "./applications/data";

/** The workspace tabs of one application, in the order a search happens. */
export const WORKSPACE_TABS = [
	"fit",
	"questions",
	"apply",
	"prepare",
	"practise",
	"debrief",
	"messages",
	"saved",
] as const;
export const workspaceTabSchema = z.enum(WORKSPACE_TABS);
export type WorkspaceTab = z.infer<typeof workspaceTabSchema>;

export const careerScopeSchema = z.object({ applicationId: z.string().min(1).nullable().default(null) });

export const careerSourceSchema = z.object({
	kind: z.enum([
		"user-message",
		"resume",
		"letter",
		"resume-version",
		"letter-version",
		"attachment",
		"manual",
		"debrief",
		"import",
	]),
	id: z.string().max(255),
	quote: z.string().max(4000),
});
export type CareerSource = z.infer<typeof careerSourceSchema>;

export const factCategorySchema = z.enum(["accomplishment", "experience", "skill", "preference"]);
export type FactCategory = z.infer<typeof factCategorySchema>;

export const careerFactRevisionSchema = z.object({
	text: z.string(),
	at: z.string(),
	category: z.string().optional(),
	applicationId: z.string().nullable().optional(),
});
export type CareerFactRevision = z.infer<typeof careerFactRevisionSchema>;

/** A separate correction contract prevents older servers from saving text while ignoring its private scope. */
export const careerFactCorrectionSchema = z
	.object({
		id: z.string().min(1),
		before: z.object({ text: z.string(), category: z.string(), applicationId: z.string().nullable() }),
		text: z.string().trim().min(1).max(2000).optional(),
		category: factCategorySchema.optional(),
		applicationId: z.string().min(1).nullable().optional(),
	})
	.strict()
	.refine((input) => input.text !== undefined || input.category !== undefined || input.applicationId !== undefined, {
		message: "Choose a correction.",
	});
export type CareerFactCorrection = z.infer<typeof careerFactCorrectionSchema>;

export const memoryModeSchema = z.enum(["ask", "auto", "off"]);
export type MemoryMode = z.infer<typeof memoryModeSchema>;

const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const payPeriodSchema = z.enum(["hour", "month", "year"]);
// Normalized length bounds belong to the output, not the raw OpenAPI input.
const profileListEntrySchema = z
	.string()
	.trim()
	.regex(/\S/)
	.pipe(z.string().min(1).max(200))
	.describe(
		"Trimmed before validation. The 1 to 200 character limit applies after trimming; whitespace-only values are rejected.",
	);

/** Independent Facts and Preferences writes have no defaults: an omitted field must stay omitted. */
export const careerProfileUpdateSchema = z
	.object({
		targetRoles: z.array(profileListEntrySchema).max(20),
		/** The kinds of role a resume is aimed at, such as Platform / reliability: the choices for an application's lanes. */
		lanes: z.array(z.string().trim().min(1).max(100)).max(20),
		locations: z.array(profileListEntrySchema).max(20),
		/** "Leave out titles with": found roles whose title has one of these are hidden. */
		excludeTitles: z.array(z.string().trim().min(1).max(200)).max(50),
		/** "What matters to you", in the user's own words. */
		priorities: z.string().max(4000),
		minBase: z.object({
			amount: z.number().nonnegative().nullable(),
			currency: currencySchema,
			period: payPeriodSchema,
		}),
		/** 0 is fully remote. */
		maxOfficeDays: z.number().int().min(0).max(5).nullable(),
		noticeWeeks: z.number().int().min(0).max(52).nullable(),
		memoryMode: memoryModeSchema,
		/**
		 * Countries web searches target, first is primary. Absent or null is automatic (from the account
		 * time zone), [] is anywhere. No default, so a save that leaves it out keeps the stored value.
		 */
		searchRegions: searchRegionsSchema,
	})
	.partial();
export type CareerProfileUpdate = z.infer<typeof careerProfileUpdateSchema>;

/** Stored preferences, used by discovery, Fit, Offers and the coach. Defaults apply only on reads. */
export const careerProfileDataSchema = careerProfileUpdateSchema.extend({
	targetRoles: careerProfileUpdateSchema.shape.targetRoles.default([]),
	lanes: careerProfileUpdateSchema.shape.lanes.default([]),
	locations: careerProfileUpdateSchema.shape.locations.default([]),
	excludeTitles: careerProfileUpdateSchema.shape.excludeTitles.default([]),
	priorities: careerProfileUpdateSchema.shape.priorities.default(""),
	minBase: careerProfileUpdateSchema.shape.minBase.default({ amount: null, currency: "USD", period: "year" }),
	maxOfficeDays: careerProfileUpdateSchema.shape.maxOfficeDays.default(null),
	noticeWeeks: careerProfileUpdateSchema.shape.noticeWeeks.default(null),
	memoryMode: careerProfileUpdateSchema.shape.memoryMode.default("ask"),
});
export type CareerProfileData = z.infer<typeof careerProfileDataSchema>;

/**
 * How much Knowledge each AI request may carry and how long it may run (Settings → AI & developer → AI limits). The
 * defaults keep a whole prompt within small-context providers and suit fast hosted models; larger or slower models can
 * be given more. Budgets are JSON characters, counts are items, times are seconds.
 */
export const aiLimitsSchema = z.object({
	/** Coach: switched-on facts shared up front with every message. */
	coachFacts: z.number().int().min(0).max(1000).default(30),
	/** Coach: usable stories shared up front with every message. */
	coachStories: z.number().int().min(0).max(200).default(8),
	/** Coach: facts returned by one knowledge search. */
	searchFactChars: z.number().int().min(2000).max(1_000_000).default(12_000),
	/** Coach: stories returned by one knowledge search. */
	searchStoryChars: z.number().int().min(2000).max(1_000_000).default(16_000),
	/** Fit, Apply, Prepare and the other application actions: facts in one request. */
	actionFactChars: z.number().int().min(2000).max(1_000_000).default(10_000),
	/** Fit, Apply, Prepare and the other application actions: stories in one request. */
	actionStoryChars: z.number().int().min(2000).max(1_000_000).default(10_000),
	/** Application actions: the posting's text in one request. */
	actionPostingChars: z.number().int().min(500).max(1_000_000).default(12_000),
	/** Application actions: the requirements read from the posting, in one request. */
	actionRequirementChars: z.number().int().min(500).max(1_000_000).default(6000),
	/** Application actions: the user's own notes on the application. */
	actionNotesChars: z.number().int().min(500).max(1_000_000).default(3000),
	/** Application actions: the job search's notes on the posting. */
	actionSearchNotesChars: z.number().int().min(500).max(1_000_000).default(3000),
	/** Application actions: the resume targeting note (its opening carries the summary). */
	actionTargetingNotesChars: z.number().int().min(500).max(1_000_000).default(6000),
	/** Application actions: the application's contacts. */
	actionContactChars: z.number().int().min(500).max(1_000_000).default(3000),
	/** Application actions: the resume sent or linked, as text. */
	actionResumeChars: z.number().int().min(500).max(1_000_000).default(10_000),
	/** Application actions: the cover letter sent or linked, as text. */
	actionLetterChars: z.number().int().min(500).max(1_000_000).default(6000),
	/** Practise: the story chosen for an answer, within "Stories in each action". Its title keeps 300; its parts share the rest. */
	practiceStoryChars: z.number().int().min(500).max(1_000_000).default(8500),
	/** Fit: requirements scored in one check. Extra rows from the model are dropped, not an error. */
	fitRequirements: z.number().int().min(5).max(100).default(20),
	/** Requirements kept when a posting is read into an application. */
	postingRequirements: z.number().int().min(5).max(100).default(30),
	/** Fit, Apply, Prepare and the other application actions, including scheduled preparation. */
	actionTimeoutSeconds: z.number().int().min(30).max(900).default(120),
	/** Coach and Assistant: one model call within a reply. Never more than the whole reply's limit. */
	replyStepTimeoutSeconds: z.number().int().min(30).max(840).default(120),
	/** Coach and Assistant: a whole reply, tools included. Stays under the 15-minute stale-run cleanup. */
	replyTimeoutSeconds: z.number().int().min(60).max(840).default(240),
	/** One scheduled discovery run: its search plus reading every posting found. Inside the job's 16-minute lease. */
	discoveryTimeoutSeconds: z.number().int().min(30).max(900).default(90),
	/** One web search or page read, fallback to the built-in reader included. Search services get 6 seconds less. */
	webCallTimeoutSeconds: z.number().int().min(10).max(120).default(20),
	/** Turning one voice answer into text. */
	transcriptionTimeoutSeconds: z.number().int().min(10).max(600).default(60),
	/** Reading one text aloud. */
	speechTimeoutSeconds: z.number().int().min(10).max(300).default(30),
	/** Coach: applications `list_opportunities` returns, most recently changed first. */
	coachApplications: z.number().int().min(10).max(500).default(50),
	/** Coach: interview debriefs `read_real_interview_history` returns, newest first, counted after filtering. */
	coachInterviews: z.number().int().min(5).max(200).default(30),
	/** Coach and Assistant: model calls in one reply, tool rounds included. */
	replySteps: z.number().int().min(5).max(100).default(30),
	/** Coach and Assistant: the longest answer one model call in a reply may give. */
	replyOutputTokens: z.number().int().min(1024).max(64_000).default(8192),
	/**
	 * Coach and Assistant: the conversation kept in view, in estimated tokens; older tool results and turns are pruned
	 * past it. Null fits it to the connection's context window (see `replyContextBudget`).
	 */
	replyContextTokens: z.number().int().min(10_000).max(2_000_000).nullable().default(null),
	/** Coach and Assistant: text read from one text, Markdown or JSON attachment. */
	attachmentTextChars: z.number().int().min(2000).max(1_000_000).default(40_000),
	/** Coach and Assistant: web searches and page reads in one reply. */
	replyWebCalls: z.number().int().min(0).max(30).default(6),
	/** Knowledge review: requests in one review; facts past them wait for the next one. */
	reviewBatches: z.number().int().min(1).max(50).default(8),
	/** Knowledge review: JSON characters in one request. Null uses `actionFactChars + actionStoryChars`. */
	reviewBatchChars: z.number().int().min(4000).max(2_000_000).nullable().default(null),
	/** Writing review: rewrite suggestions kept from one review. */
	reviewSuggestions: z.number().int().min(1).max(30).default(12),
	/** Voice: the longest recording or dictation in Practise. Read in the browser. */
	recordingSeconds: z.number().int().min(30).max(600).default(120),
	/**
	 * Every AI request without a time limit of its own: Writing review, Improve, reading PDF and Word files, the
	 * application AI and drafting letters.
	 */
	requestTimeoutSeconds: z.number().int().min(30).max(900).default(120),
	/** Retries after a failed model call, for every model call except voice and the connection test. */
	modelRetries: z.number().int().min(0).max(5).default(2),
	/** The longest structured (JSON) answer. Null sends no limit, so the provider's default applies. */
	jsonOutputTokens: z.number().int().min(1024).max(64_000).nullable().default(null),
	/** Reading one job board's list of roles or one of its job pages. */
	boardFetchTimeoutSeconds: z.number().int().min(10).max(120).default(30),
	/** Text kept from one page read: `read_page`, posting links and discovery. Saved postings keep their own cap. */
	webPageChars: z.number().int().min(2000).max(200_000).default(20_000),
	/** Results kept from one web search. */
	webSearchResults: z.number().int().min(1).max(20).default(5),
});
export type AiLimits = z.infer<typeof aiLimitsSchema>;

/**
 * A fact's group: a path such as `experience/acme` or `clearance`, with slashes between levels. Spaces around each
 * level and empty levels are dropped, so `experience / acme/` is `experience/acme`.
 */
export const factGroupSchema = z
	.string()
	.max(200)
	.transform((value) =>
		value
			.split("/")
			.map((part) => part.trim())
			.filter(Boolean)
			.join("/"),
	)
	.pipe(z.string().min(1, "A group needs a name."));

/** What a fact switch or a group switch sets. */
export const factSwitchSchema = z.enum(["active", "excluded"]);

/** A fact's status as it can be set: switched on or off, or archived (kept, hidden, never sent; switch it to restore). */
export const factStatusSchema = z.enum(["active", "excluded", "archived"]);

/** What a Knowledge review found: facts that disagree, an older figure next to a newer one, or a claim with nothing behind it. */
export const knowledgeFindingSchema = z.object({
	id: z.string(),
	kind: z.enum(["contradiction", "superseded", "unsupported"]),
	factIds: z.array(z.string()).min(1).max(4),
	/** One plain sentence on what's wrong. */
	note: z.string().max(400),
	/** For superseded facts: the newer one to keep. */
	keep: z.string().nullable(),
	/** fixed when acted on, dismissed when it isn't a problem; null while open. */
	resolved: z.enum(["fixed", "dismissed"]).nullable(),
});
export type KnowledgeFinding = z.infer<typeof knowledgeFindingSchema>;

/** The last Knowledge review: when, on which connection, how much it read, and what it found. */
export const knowledgeReviewSchema = z.object({
	at: z.string(),
	connection: z.string(),
	/** Facts it read, of those that reach the AI; the rest didn't fit the batches it may send. */
	reviewed: z.number().int(),
	total: z.number().int(),
	/** Application copies of shared facts it removed before reading, which needs no judgment. */
	cleaned: z.number().int(),
	findings: z.array(knowledgeFindingSchema),
});
export type KnowledgeReview = z.infer<typeof knowledgeReviewSchema>;

/** An application's exception: include a group or fact the AI wouldn't otherwise get, or exclude one it would. */
export const overrideModeSchema = z.enum(["include", "exclude"]);

export const careerFactInputSchema = careerScopeSchema.extend({
	text: z.string().trim().min(1).max(2000),
	category: factCategorySchema,
	source: careerSourceSchema,
	/** New facts in a group start switched on or off as the group was last switched. */
	group: factGroupSchema.nullable().optional(),
});

/** Reviewed facts from a file read by the client. The original quote survives edits to the proposed text. */
export const careerImportFactInputSchema = careerFactInputSchema.omit({ applicationId: true }).extend({
	source: careerSourceSchema.extend({
		kind: z.literal("import"),
		id: z
			.string()
			.max(255)
			.regex(/^import:v1:[a-f0-9]{64}:[a-z0-9/.-]+$/),
		quote: z.string().trim().min(1).max(4000),
	}),
});

export const careerImportFactsInputSchema = z.object({
	facts: z.array(careerImportFactInputSchema).min(1).max(500),
});

export const careerImportFactsResultSchema = z.object({
	results: z.array(
		z.object({
			sourceId: z.string(),
			status: z.enum(["saved", "duplicate", "suppressed"]),
			factId: z.string().nullable(),
		}),
	),
});
export type CareerImportFact = z.infer<typeof careerImportFactInputSchema>;
export type CareerImportFactsResult = z.infer<typeof careerImportFactsResultSchema>;
// Bound submitted input before normalization so runtime and published lengths agree.
export const MAX_RESUME_FACT_CHARACTERS = 2000;
const resumeFactTextSchema = z.string().max(MAX_RESUME_FACT_CHARACTERS).trim().min(1).regex(/\S/);

export const resumeFactProposalSchema = careerFactInputSchema.pick({ text: true, category: true }).extend({
	text: resumeFactTextSchema.describe(
		"Non-blank fact text. At most 2,000 characters including surrounding whitespace; trimmed before saving.",
	),
	quote: resumeFactTextSchema.describe(
		"Non-blank source quotation. At most 2,000 characters including surrounding whitespace; trimmed before saving.",
	),
});
export const resumeFactsReviewSchema = z.object({
	resumeId: z.string().min(1),
	updatedAt: z.coerce.date(),
	proposals: z.array(resumeFactProposalSchema).min(1).max(50),
});

export const careerStoryInputSchema = careerScopeSchema.extend({
	title: z.string().trim().min(1).max(200),
	situation: z.string().trim().min(1).max(4000),
	task: z.string().trim().min(1).max(4000),
	action: z.string().trim().min(1).max(6000),
	result: z.string().trim().max(4000).default(""),
	reflection: z.string().trim().max(4000).default(""),
	factIds: z.array(z.string().min(1)).max(30).default([]),
	tags: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
});
export type CareerStoryData = z.infer<typeof careerStoryInputSchema>;

const validBonus = (terms: { variable: number | null; variablePercent?: number | null | undefined }) =>
	terms.variable === null || terms.variablePercent == null;
const bonusError = { message: "Enter a bonus amount or a percentage, not both.", path: ["variablePercent"] };

/** Offer terms in their own currency and pay period. Unknown amounts are null, never zero. */
export const offerTermsSchema = z
	.object({
		version: z.enum(["written", "verbal"]).default("written"),
		currency: currencySchema,
		period: payPeriodSchema,
		base: z.number().nonnegative().nullable(),
		variable: z.number().nonnegative().nullable(),
		/** Percentage of base, in the base currency and pay period. Older amount records omit this. */
		variablePercent: z
			.number()
			.nonnegative()
			.nullable()
			.optional()
			.describe(
				"Percentage points of base: 10 means 10% of base in its currency and pay period. Set variable to null.",
			),
		/** What the bonus depends on, or "" when unconditional or unknown. */
		variableConditions: z.string().max(1000).default(""),
		equity: z.string().max(1000).default(""),
		location: z.string().max(500).default(""),
		officeDays: z.number().int().min(0).max(5).nullable().default(null),
		leave: z.string().max(500).default(""),
		learning: z.number().nonnegative().nullable().default(null),
		other: z.string().max(1000).default(""),
		respondBy: z.iso.datetime({ offset: true }).nullable().default(null),
		/** The first day of work the employer stated, as a local date (YYYY-MM-DD). */
		startDate: z.iso.date().nullable().default(null),
	})
	.refine(validBonus, bonusError);
export type OfferTerms = z.infer<typeof offerTermsSchema>;

/** Manually entered terms use the same saved offer shape as confirmed message proposals. */
export const careerOfferInputSchema = offerTermsSchema.safeExtend({ applicationId: z.string().min(1) });

const text = (max = 2000) => z.string().trim().max(max);

/** One requirement in a Fit check, with how well the user's Knowledge supports it. */
export const fitRequirementSchema = z.object({
	text: text(300),
	origin: z.enum(["posting", "inferred"]),
	status: z.enum(["supported", "partial", "missing"]),
	evidence: text(600),
	factIds: z.array(z.string()).max(10).default([]),
});

/** The application fields applying an employer's message can change. */
const appliedFieldsSchema = z.object({
	status: applicationStatusSchema,
	laneId: z.string().nullable(),
	closedReason: applicationClosedReasonSchema.nullable(),
	followUpAt: z.iso.datetime({ offset: true }).nullable(),
	followUpNote: z.string().nullable(),
	followUpDateOnly: z.boolean().default(false),
});

/**
 * What the coach wrote for an application, by kind. Each one is produced by `career.generate` from a fixed shape,
 * so tabs render it without parsing prose, and it still opens when the provider is down.
 */
export const savedItemDataSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("fit"),
		headline: text(200),
		summary: text(600),
		requirements: z
			.array(fitRequirementSchema)
			// The most "Requirements Fit scores" allows, so a saved Fit still loads after that limit is lowered.
			.max(100),
		/** Checks against Preferences: salary, office days, location. `met: null` is "needs confirming". */
		checks: z.array(z.object({ label: text(60), met: z.boolean().nullable(), text: text(300) })).max(5),
		ask: z.object({ person: text(100), text: text(400) }).nullable(),
	}),
	z.object({
		kind: z.literal("briefing"),
		headline: text(200),
		summary: text(300),
		plan: z
			.array(
				z.object({
					minutes: z.number().int().min(1).max(60),
					title: text(120),
					detail: text(400),
					action: z.enum(["story", "draft-story", "questions", "practise", "none"]),
					storyId: z.string().nullable().default(null),
					/** Explicit supporting facts for this step; older briefings omit the field. */
					factIds: z.array(z.string().min(1)).max(20).optional(),
				}),
			)
			.max(8),
		questions: z.array(z.object({ text: text(400), origin: text(60) })).max(8),
		focus: text(500),
		opening: text(600),
		stories: z.array(text(300)).max(3),
		honesty: text(400),
		storyIds: z.array(z.string()).max(5).default([]),
		/** A story the interviewer asked for that Knowledge doesn't have yet. */
		missingStory: text(300).nullable().default(null),
		practiceQuestions: z.array(text(300)).max(5).default([]),
	}),
	z.object({
		kind: z.literal("practice"),
		question: text(500),
		origin: z.enum(["simulated", "recalled"]),
		mode: z.enum(["typed", "spoken"]),
		answer: text(6000),
		title: text(200),
		works: text(500),
		strengthen: text(500),
		opening: text(800),
		/** A three-word result note for the attempts rail, e.g. "Contribution unclear". */
		note: text(60),
	}),
	z.object({
		kind: z.literal("debrief"),
		round: text(100),
		question: text(500),
		answer: text(6000),
		landed: z.enum(["well", "mixed", "not"]),
		title: text(200),
		verdicts: z.array(z.object({ tag: z.enum(["supported", "observation"]), text: text(400) })).max(6),
		nextRound: text(600),
		priority: text(400),
		/** Something the interviewer asked for, worth remembering for this application only. */
		remember: text(400).nullable().default(null),
		plan: z
			.array(
				z.object({
					day: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
					minutes: z.number().int().min(5).max(120),
					task: text(300),
				}),
			)
			.max(5),
	}),
	z.object({
		kind: z.literal("answers"),
		answers: z
			.array(z.object({ question: text(), answer: text(6000), aiOperationIds: aiOperationIdsSchema.optional() }))
			.max(30),
	}),
	z.object({
		kind: z.literal("reply"),
		message: text(20_000),
		title: text(200),
		asks: z.array(text(300)).max(5),
		unconfirmed: z.array(text(300)).max(5),
		reply: text(4000),
		changes: z
			.array(
				z.discriminatedUnion("type", [
					z.object({
						type: z.literal("stage"),
						// Never "applied": marking a submission is Apply's job, with the versions sent.
						stage: z.enum(["screening", "interview", "offer", "closed"]),
					}),
					/** The application's next step, with a reminder when a reply is due. */
					z.object({ type: z.literal("follow-up"), at: z.iso.datetime({ offset: true }).nullable(), note: text(300) }),
					z.object({ type: z.literal("offer") }),
				]),
			)
			.max(4),
		offer: offerTermsSchema.nullable().default(null),
		/** Set when the user applied the proposal: which changes, and when. */
		applied: z
			.object({
				at: z.iso.datetime({ offset: true }),
				changes: z.array(z.number().int()),
				/** The application fields Apply set, before and after, and the offer it saved: what Undo reverses. */
				undo: z
					.object({
						before: appliedFieldsSchema,
						after: appliedFieldsSchema,
						offerId: z.string().nullable(),
					})
					.optional(),
			})
			.nullable()
			.default(null),
	}),
	z
		.object({
			kind: z.literal("offer"),
			...offerTermsSchema.shape,
			/** Typed in by the user, or read from an employer's message. Absent on offers saved before it was recorded. */
			origin: z.enum(["manual", "message"]).optional(),
			/** When the user last corrected the terms by hand. */
			editedAt: z.iso.datetime({ offset: true }).optional(),
		})
		.refine(validBonus, bonusError),
]);
export type SavedItemData = z.infer<typeof savedItemDataSchema>;
export type SavedItemKind = SavedItemData["kind"];

/** Immutable manual review, stored separately from mutable workspace data. */
export const submissionReviewSchema = z.object({
	at: z.iso.datetime({ offset: true }),
	checklist: z.array(z.number().int().min(0).max(10)).max(10),
	documents: z.boolean(),
	answers: z.boolean(),
	answerVersionId: z.string().nullable().optional(),
	stageEntryId: z.string().nullable().optional(),
});

/**
 * Live, user-owned state of one application's workspace. Each widget owns one key and saves the whole value, so
 * the fields have no defaults: a partial save must not reset the keys it leaves out. Start from `EMPTY_WORKSPACE`.
 */
export const careerWorkspaceSchema = z.object({
	answers: z
		.array(
			z.object({
				id: z.string().min(1).max(64),
				question: text(),
				answer: text(6000),
				factIds: z.array(z.string()).max(10),
				aiOperationIds: aiOperationIdsSchema.optional(),
			}),
		)
		.max(30),
	/** Indexes of the ticked "Before you submit" items. */
	checklist: z.array(z.number().int().min(0).max(10)).max(10),
	/** Server-owned first-submission review; null means historical checks were not recorded. */
	submissionReview: submissionReviewSchema.nullable().optional(),
	/** Questions to ask, added from Fit or the coach. */
	questions: z.array(z.object({ text: text(400), origin: text(60) })).max(20),
	/** Fit requirements closed with "Add evidence": requirement text → the new fact's id. */
	evidence: z.record(z.string().max(300), z.string().max(64)),
	/** Ticked rows per list: "plan:{savedItemId}", "now:{interviewId}", "week:{savedItemId}". */
	ticks: z.record(z.string().max(100), z.array(z.string().max(20)).max(20)),
	/** The employer message pasted into Messages, kept with the application. */
	message: text(20_000),
});
export const careerWorkspaceDataSchema = careerWorkspaceSchema.omit({ submissionReview: true });
export type CareerWorkspace = z.infer<typeof careerWorkspaceSchema>;
export const EMPTY_WORKSPACE: CareerWorkspace = {
	answers: [],
	checklist: [],
	questions: [],
	evidence: {},
	ticks: {},
	message: "",
};

/** What a tab asks the coach to write. */
export const generateTaskSchema = z.discriminatedUnion("task", [
	z.object({ task: z.literal("fit") }),
	z.object({ task: z.literal("briefing"), interviewId: z.string().min(1) }),
	z.object({
		task: z.literal("practice"),
		storyId: z.string().min(1).optional(),
		interviewId: z.string().min(1).nullable(),
		question: text(500).min(1),
		origin: z.enum(["simulated", "recalled"]),
		mode: z.enum(["typed", "spoken"]),
		answer: text(6000).min(10),
	}),
	z.object({
		task: z.literal("debrief"),
		interviewId: z.string().min(1).nullable(),
		question: text(500).min(1),
		answer: text(6000).min(1),
		landed: z.enum(["well", "mixed", "not"]),
	}),
	z.object({
		task: z.literal("reply"),
		message: text(20_000).min(1),
		/** The user's explicit choice to write the reply in their interface language instead of the employer's. */
		replyLocale: z.string().min(2).max(20).optional(),
	}),
	/** Not saved: a shorter answer, or a first draft when `answer` is empty. */
	z.object({
		task: z.literal("answer"),
		question: text().min(1),
		answer: text(6000),
	}),
]);
export type GenerateTask = z.infer<typeof generateTaskSchema>;

/**
 * A notification, stored as what happened rather than as words. The server writes its English title and body when it's
 * read, so a later release can show the same notices in the reader's language (and any times in their timezone).
 */
export const careerNoticeSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("opportunities"),
		count: z.number().int().min(1),
		query: z.string(),
		/** Board checks: their roles came from watched companies' job boards, not a search. */
		source: z.enum(["search", "boards"]).optional(),
		/** Board checks: companies whose board couldn't be read this run (their last postings are kept). */
		failed: z.array(z.string()).optional(),
	}),
	/** A board check found nothing new, and some boards couldn't be read. */
	z.object({ type: z.literal("boards-failed"), failed: z.array(z.string()) }),
	z.object({ type: z.literal("briefing"), company: z.string(), role: z.string() }),
	z.object({ type: z.literal("followup"), company: z.string(), role: z.string(), note: z.string().optional() }),
	z.object({ type: z.literal("schedule-failed"), reason: z.enum(["stopped", "failed"]) }),
	z.object({ type: z.literal("email-failed") }),
	z.object({ type: z.literal("briefing-paused") }),
]);
export type CareerNotice = z.infer<typeof careerNoticeSchema>;

export const careerScheduleInputSchema = careerScopeSchema.extend({
	/** boards: the job boards of companies watched in the Directory, one schedule per account. */
	kind: z.enum(["discovery", "boards", "prepare", "follow-up"]),
	query: z
		.string()
		.trim()
		.default("")
		.describe("Discovery search query (up to 500 characters), or the application follow-up note."),
	interviewId: z.string().nullable().default(null),
	/** Prepare only: when the briefing runs relative to the interview. */
	lead: z.enum(["24h", "2h", "morning"]).nullable().default(null),
	enabled: z.boolean().default(true),
	email: z.boolean().default(false),
	nextRunAt: z.coerce.date(),
	timezone: timezoneSchema,
	intervalDays: z.number().int().min(1).max(30).nullable().default(null),
	aiProviderId: z.string().min(1).nullable().default(null),
	/** The interface language; a scheduled briefing is written in it. Kept when left out. */
	locale: z.string().min(2).max(20).optional(),
});

/** Recorded retrieval context, not a promise that the employer is still accepting applications. */
export const discoverySourceSchema = z.object({
	query: z.string().max(500),
	checkedAt: z.string().datetime(),
});
export type DiscoverySource = z.infer<typeof discoverySourceSchema>;

export const roleSuggestionsInputSchema = z.object({
	providerId: z.string().min(1),
	/** Configuration disclosed when the user approved sharing, from aiProviders.list. */
	recipientVersion: z.string().regex(/^[a-f0-9]{64}$/),
	resumeId: z.string().min(1).nullable(),
	includeKnowledge: z.boolean(),
	locale: z.string().max(20).default("en-US"),
});
export const roleSuggestionsOutputSchema = z.object({
	suggestions: z
		.array(
			z.object({
				role: z.string().trim().min(1).max(200),
				facts: z.array(z.object({ id: z.string(), text: z.string() })),
				resumeQuote: z.string().max(500).nullable(),
			}),
		)
		.max(5),
});
