import type { ApplicationDocumentKind, EditableFields } from "../../dto/application";
import type { DbOrTx } from "@reactive-resume/db/client";
import type {
	AiMetadata,
	ApplicationClosedReason,
	ApplicationStatus,
	ApplicationTimelineEntry,
	InterviewDetails,
	TargetingQuestion,
	TargetingQuestionStatus,
} from "@reactive-resume/schema/applications/data";
import { ORPCError } from "@orpc/client";
import { and, arrayContains, count, desc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { lintResumeForAts } from "@reactive-resume/resume/ats";
import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { targetingFitOf } from "@reactive-resume/schema/applications/data";
import { coverLetterSchema } from "@reactive-resume/schema/cover-letter/data";
import { generateId } from "@reactive-resume/utils/string";
import { requestRunCancellation } from "../agent/cancellation";
import { prepareRunAt } from "../career/scheduling";
import { coverLetterService } from "../cover-letters/service";
import { writeLetterVersion } from "../cover-letters/versions";
import { linkApplicationDirectory, lockDirectoryOwner } from "../directory/links";
import { lockUser } from "../documents/ownership";
import { resumeService } from "../resume/service";
import { writeVersion } from "../resume/version-history";
import { getStorageService, uploadFile } from "../storage/service";
import { snapshotSentAnswers } from "./answers";
import { applicationTransitionValues, ensureApplicationPipeline } from "./lanes";

function timelineDate(value: Date | string): Date {
	return value instanceof Date ? value : new Date(value);
}

function atFromDateString(date: string, existing?: Date | string): Date {
	const [year, month, day] = date.split("-").map(Number);
	if (!year || !month || !day) throw new ORPCError("BAD_REQUEST", { message: "Enter the date as YYYY-MM-DD." });

	const existingDate = existing ? timelineDate(existing) : undefined;

	const parsed = new Date(
		Date.UTC(
			year,
			month - 1,
			day,
			existingDate?.getUTCHours() ?? 12,
			existingDate?.getUTCMinutes() ?? 0,
			existingDate?.getUTCSeconds() ?? 0,
			existingDate?.getUTCMilliseconds() ?? 0,
		),
	);
	if (timelineDay(parsed) !== date) throw new ORPCError("BAD_REQUEST", { message: "Enter the date as YYYY-MM-DD." });

	return parsed;
}

function noteEntry(text: string, date?: string): ApplicationTimelineEntry {
	return { id: generateId(), type: "note", text, at: date ? atFromDateString(date) : new Date() };
}

function interviewAt(value: string): Date {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime()))
		throw new ORPCError("BAD_REQUEST", { message: "Enter a valid interview date and time." });
	return parsed;
}

function interviewEntry(at: string, details: InterviewDetails): ApplicationTimelineEntry {
	return { id: generateId(), type: "interview", at: interviewAt(at), ...details };
}

function timelineDay(value: Date | string) {
	return timelineDate(value).toISOString().slice(0, 10);
}

function sortTimeline(activity: ApplicationTimelineEntry[]): ApplicationTimelineEntry[] {
	return [...activity].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/** Lane-only transitions also anchor the current stage. Retirement preserves the last event's identity. */
function currentStageAnchor(activity: ApplicationTimelineEntry[], status: ApplicationStatus) {
	return sortTimeline(activity).find((entry) => entry.type === "stage" && entry.stage === status);
}

function assertCurrentStageAnchorLatest(
	activity: ApplicationTimelineEntry[],
	status: ApplicationStatus,
	anchorId?: string,
) {
	// Capture identity before editing dates; re-resolving after a date edit could select another lane's event.
	const anchor = anchorId ? activity.find((entry) => entry.id === anchorId) : currentStageAnchor(activity, status);
	if (!anchor)
		throw new ORPCError("BAD_REQUEST", {
			message: "This application's timeline is missing its current stage. Reload the application and try again.",
		});
	const anchorDay = timelineDay(anchor.at);
	if (activity.some((entry) => entry.type === "stage" && timelineDay(entry.at) > anchorDay)) {
		throw new ORPCError("BAD_REQUEST", { message: "Choose a current stage date on or after the other stage dates." });
	}
}

function appliedAtFromTimeline(activity: ApplicationTimelineEntry[], fallback: Date): Date {
	const sorted = sortTimeline(activity).filter(
		(entry) => entry.type !== "stage" || entry.canonicalTransition !== false,
	);
	const applied = sorted.find((entry) => entry.type === "stage" && entry.stage === "applied");
	const fallbackEntry = sorted.at(-1);
	return applied ? timelineDate(applied.at) : fallbackEntry ? timelineDate(fallbackEntry.at) : fallback;
}

/**
 * Sets the targeting fit from the reviews when they're written, and dates the search and targeting assessments when
 * they're written without a date: saving a search fit or search notes
 * sets `searchAt`, and saving any targeting field sets `targetingAt`. An explicit date (a backfill's) wins, and
 * clearing the fields leaves the date alone.
 */
export function stampAssessments<T extends EditableFields>(fields: T, now: Date): T & { targetingFit?: number | null } {
	const written = (...values: unknown[]) => values.some((value) => value !== undefined && value !== null);
	return {
		...fields,
		// The targeting fit follows the reviews; nobody sets it directly.
		...(fields.targetingReviews !== undefined ? { targetingFit: targetingFitOf(fields.targetingReviews) } : {}),
		...(fields.searchAt === undefined && written(fields.searchFit, fields.searchNotes) ? { searchAt: now } : {}),
		...(fields.targetingAt === undefined &&
		written(
			fields.targetingNotes,
			fields.targetingReviews?.length ? fields.targetingReviews : undefined,
			fields.targetingPrimaryLane,
			fields.targetingSecondaryLane,
			fields.targetingQuestions?.length ? fields.targetingQuestions : undefined,
		)
			? { targetingAt: now }
			: {}),
	};
}

const questionKey = (question: Pick<TargetingQuestion, "question">) =>
	question.question.trim().replace(/\s+/g, " ").toLowerCase();

/** How a topic was settled on some application: what a question with that topic arriving elsewhere takes over. */
export type SettledTopic = Pick<TargetingQuestion, "status" | "answer" | "factId" | "answeredAt"> & {
	answeredOn: NonNullable<TargetingQuestion["answeredOn"]>;
};

/**
 * A new list of targeting questions over the saved one. Questions the user answered or set aside stay exactly as they
 * are, and an incoming question matching one of them (same id, same text, or same topic) is dropped. Open ones are
 * replaced by the new list. An incoming question whose topic was already settled on another application arrives
 * settled the same way, marked with where.
 */
export function mergeTargetingQuestions(
	current: TargetingQuestion[],
	incoming: TargetingQuestion[],
	elsewhere: ReadonlyMap<string, SettledTopic> = new Map(),
): TargetingQuestion[] {
	const settled = current.filter((question) => question.status !== "open");
	const settledIds = new Set(settled.map((question) => question.id));
	const settledText = new Set(settled.map(questionKey));
	const settledTopics = new Set(settled.flatMap((question) => (question.topic ? [question.topic] : [])));
	const fresh = incoming
		.filter(
			(question) =>
				!settledIds.has(question.id) &&
				!settledText.has(questionKey(question)) &&
				!(question.topic && settledTopics.has(question.topic)),
		)
		.map((question) => {
			const prior = question.topic && question.status === "open" ? elsewhere.get(question.topic) : undefined;
			return prior ? { ...question, ...prior } : question;
		});
	return [...settled, ...fresh];
}

/** Topics answered or set aside on the user's other applications, with how. */
async function settledTopicsElsewhere(client: DbOrTx, userId: string, exceptId?: string) {
	const rows = await client
		.select({
			id: schema.application.id,
			company: schema.application.company,
			questions: schema.application.targetingQuestions,
		})
		.from(schema.application)
		.where(
			and(
				eq(schema.application.userId, userId),
				sql`jsonb_path_exists(${schema.application.targetingQuestions}, '$[*] ? (@.topic != null && @.status != "open")')`,
			),
		);
	const settled = new Map<string, SettledTopic>();
	for (const row of rows) {
		if (row.id === exceptId) continue;
		for (const question of row.questions) {
			if (!question.topic || question.status === "open" || question.answeredOn || settled.has(question.topic)) continue;
			settled.set(question.topic, {
				status: question.status,
				answer: question.answer,
				factId: question.factId,
				answeredAt: question.answeredAt,
				answeredOn: { applicationId: row.id, company: row.company },
			});
		}
	}
	return settled;
}

// The list leaves out the targeting note, which can run to tens of kilobytes, and returns null in its place;
// getById returns it.
const { targetingNotes: _targetingNotes, ...listColumns } = getTableColumns(schema.application);

// All reads/writes filter on userId — the single ownership guard every route funnels through.
async function requireOwned(id: string, userId: string) {
	const [row] = await db
		.select()
		.from(schema.application)
		.where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)));
	if (!row) throw new ORPCError("NOT_FOUND");
	return row;
}

async function assertOwnedResume(userId: string, resumeId: string | null | undefined) {
	if (!resumeId) return;
	await resumeService.getById({ id: resumeId, userId });
}

async function assertOwnedCoverLetter(userId: string, coverLetterId: string | null | undefined) {
	if (!coverLetterId) return;
	await coverLetterService.getById({ id: coverLetterId, userId });
}

// Stages at which an application has been sent.
const SENT_STAGES = new Set<ApplicationStatus>(["applied", "screening", "interview", "offer"]);

type ApplicationRow = typeof schema.application.$inferSelect;

/**
 * Once an application has been sent (Applied or later), its linked resume is saved as a "sent" version, named after
 * the company, with its Check score at the time, and so is its linked letter. The application keeps pointing at
 * them, so it can open exactly what went out while the documents move on.
 */
export async function recordSentResume(row: ApplicationRow, client: DbOrTx): Promise<ApplicationRow> {
	if (!SENT_STAGES.has(row.status)) return row;
	const changes: Partial<ApplicationRow> = {};

	if (row.resumeId && !row.sentResumeVersionId) {
		const [resume] = await client
			.select()
			.from(schema.resume)
			.where(
				and(eq(schema.resume.id, row.resumeId), eq(schema.resume.userId, row.userId), isNull(schema.resume.trashedAt)),
			)
			.for("update");
		if (!resume)
			throw new ORPCError("NOT_FOUND", { message: "The linked resume is unavailable. Restore it before submitting." });
		const version = await writeVersion(client, {
			resumeId: row.resumeId,
			userId: row.userId,
			data: resume.data,
			kind: "sent",
			name: row.company,
		});
		changes.sentResumeVersionId = version.id;
		changes.sentCheckScore = lintResumeForAts(resume.data).score;
	}

	// The letter sent with it is kept the same way.
	if (row.coverLetterId && !row.sentCoverLetterVersionId) {
		const [stored] = await client
			.select()
			.from(schema.coverLetter)
			.where(
				and(
					eq(schema.coverLetter.id, row.coverLetterId),
					eq(schema.coverLetter.userId, row.userId),
					isNull(schema.coverLetter.trashedAt),
				),
			)
			.for("update");
		if (!stored)
			throw new ORPCError("NOT_FOUND", { message: "The linked letter is unavailable. Restore it before submitting." });
		const letter = coverLetterSchema.parse(stored);
		if (letter.sourceResumeId && (letter.senderLinked || letter.designLinked)) {
			const [source] = await client
				.select()
				.from(schema.resume)
				.where(
					and(
						eq(schema.resume.id, letter.sourceResumeId),
						eq(schema.resume.userId, row.userId),
						isNull(schema.resume.trashedAt),
					),
				)
				.for("update");
			if (source) {
				const linked = copyCoverLetterStyle(source.data, letter.style.sectionId, letter.style.itemId);
				letter.style = {
					...letter.style,
					...(letter.senderLinked ? { basics: linked.basics, picture: linked.picture } : {}),
					...(letter.designLinked ? { metadata: linked.metadata } : {}),
				};
			}
		}
		const version = await writeLetterVersion(client, { letter, userId: row.userId, kind: "sent", name: row.company });
		changes.sentCoverLetterVersionId = version.id;
	}

	if (Object.keys(changes).length === 0) return row;
	const [updated] = await client
		.update(schema.application)
		.set(changes)
		.where(eq(schema.application.id, row.id))
		.returning();
	return updated ?? row;
}

async function assertOwnedResumes(userId: string, resumeIds: (string | null | undefined)[]) {
	const uniqueResumeIds = [...new Set(resumeIds.filter((id): id is string => !!id))];
	await Promise.all(uniqueResumeIds.map((resumeId) => assertOwnedResume(userId, resumeId)));
}

function storageKeyFromApplicationUrl(userId: string, value: string | null | undefined) {
	if (!value) return null;

	let pathname: string;
	try {
		pathname = value.startsWith("/") ? value : new URL(value).pathname;
	} catch {
		return null;
	}

	// Only the single file uploadFile writes (pictures/<uuid>.pdf, older ones <timestamp>.pdf): an edited URL
	// must never point delete at a folder or another kind of file.
	const key = pathname.match(/^\/(?:api\/)?(uploads\/[^/]+\/pictures\/[\w-]+\.pdf)$/)?.[1];
	return key?.startsWith(`uploads/${userId}/`) ? key : null;
}

async function deleteApplicationAttachments(
	userId: string,
	applications: Pick<EditableFields, "resumeFileUrl" | "coverLetterUrl">[],
) {
	const candidateKeys = [
		...new Set(
			applications.flatMap((application) => [
				storageKeyFromApplicationUrl(userId, application.resumeFileUrl),
				storageKeyFromApplicationUrl(userId, application.coverLetterUrl),
			]),
		),
	].filter((key): key is string => !!key);

	if (candidateKeys.length === 0) return;

	const remainingApplications = await db
		.select({
			resumeFileUrl: schema.application.resumeFileUrl,
			coverLetterUrl: schema.application.coverLetterUrl,
		})
		.from(schema.application)
		.where(eq(schema.application.userId, userId));

	const referencedKeys = new Set(
		remainingApplications.flatMap((application) => [
			storageKeyFromApplicationUrl(userId, application.resumeFileUrl),
			storageKeyFromApplicationUrl(userId, application.coverLetterUrl),
		]),
	);
	const keys = candidateKeys.filter((key) => !referencedKeys.has(key));

	if (keys.length === 0) return;
	const storageService = getStorageService();
	await Promise.allSettled(keys.map((key) => storageService.delete(key)));
}

async function deleteApplicationCoaching(userId: string, applicationIds: string[]) {
	if (!applicationIds.length) return;
	const threads = await db
		.select({ id: schema.agentThread.id, runId: schema.agentThread.activeRunId })
		.from(schema.agentThread)
		.where(and(eq(schema.agentThread.userId, userId), inArray(schema.agentThread.applicationId, applicationIds)));
	for (const thread of threads) {
		if (thread.runId) await requestRunCancellation(thread.runId, "APPLICATION_DELETED");
		await getStorageService().delete(`uploads/${userId}/agent/${thread.id}`);
	}
}

/**
 * A rescheduled round moves its briefings with it (24h, 2h or the morning before the new time); a removed round pauses
 * them and says so in Today. Either way, work already queued for the old time is canceled.
 */
async function followInterviewSchedules(
	tx: DbOrTx,
	userId: string,
	applicationId: string,
	interviewId: string,
	at: Date | null,
) {
	const schedules = await tx
		.select()
		.from(schema.careerSchedule)
		.where(
			and(
				eq(schema.careerSchedule.userId, userId),
				eq(schema.careerSchedule.applicationId, applicationId),
				eq(schema.careerSchedule.interviewId, interviewId),
			),
		)
		.orderBy(schema.careerSchedule.id)
		.for("update");
	if (!schedules.length) return;
	await tx
		.update(schema.careerJob)
		.set({ status: "canceled", lease: null, leaseUntil: null })
		.where(
			and(
				eq(schema.careerJob.userId, userId),
				inArray(
					schema.careerJob.scheduleId,
					schedules.map((row) => row.id),
				),
				inArray(schema.careerJob.status, ["queued", "running"]),
			),
		);
	for (const schedule of schedules)
		await tx
			.update(schema.careerSchedule)
			.set(
				at
					? {
							nextRunAt: prepareRunAt(at, (schedule.lead ?? "24h") as "24h" | "2h" | "morning", schedule.timezone),
							lastQueuedAt: null,
						}
					: { enabled: false },
			)
			.where(eq(schema.careerSchedule.id, schedule.id));
	if (at || !schedules.some((schedule) => schedule.enabled)) return;
	await tx.insert(schema.careerNotification).values({
		userId,
		applicationId,
		key: `interview-removed:${generateId()}`,
		notice: { type: "briefing-paused" },
		url: `/dashboard/career?schedule=${encodeURIComponent(schedules[0]?.id ?? "")}`,
	});
}

function documentFields(kind: ApplicationDocumentKind) {
	return kind === "resume"
		? ({
				file: "resumeFile",
				url: "resumeFileUrl",
				name: "resumeFileName",
			} as const)
		: ({
				file: "coverLetterFile",
				url: "coverLetterUrl",
				name: "coverLetterName",
			} as const);
}

type UploadedDocumentFields = Pick<
	EditableFields,
	"resumeFileUrl" | "resumeFileName" | "coverLetterUrl" | "coverLetterName"
>;

type DocumentFiles = { resumeFile?: File | undefined; coverLetterFile?: File | undefined };

// One request owns the uploads and record write; browser dismissal cannot strand an upload.
async function withDocumentFiles<T>(
	userId: string,
	files: DocumentFiles,
	save: (fields: UploadedDocumentFields) => Promise<T>,
) {
	const uploadedFields: UploadedDocumentFields = {};
	try {
		// ponytail: at most two sequential uploads; use allSettled if measured latency warrants concurrency.
		for (const kind of ["resume", "cover-letter"] as const) {
			const fields = documentFields(kind);
			const file = files[fields.file];
			if (!file) continue;
			if (file.type !== "application/pdf") {
				throw new ORPCError("BAD_REQUEST", { message: "Attach a PDF file." });
			}
			const uploaded = await uploadFile({
				userId,
				data: new Uint8Array(await file.arrayBuffer()),
				contentType: file.type,
			});
			uploadedFields[fields.url] = uploaded.url;
			uploadedFields[fields.name] = file.name;
		}
		return await save(uploadedFields);
	} catch (error) {
		// The record may already have committed before later work failed. Never delete referenced files.
		await deleteApplicationAttachments(userId, [uploadedFields]).catch(() => {});
		throw error;
	}
}

const stripUserId = <T extends { userId: string; activity?: ApplicationTimelineEntry[] }>(row: T) => {
	const { userId: _userId, ...rest } = row;
	return rest.activity ? { ...rest, activity: sortTimeline(rest.activity) } : rest;
};

const applicationSummarySelect = {
	id: schema.application.id,
	userId: schema.application.userId,
	company: schema.application.company,
	role: schema.application.role,
	location: schema.application.location,
	salary: schema.application.salary,
	status: schema.application.status,
	closedReason: schema.application.closedReason,
	resumeId: schema.application.resumeId,
	coverLetterId: schema.application.coverLetterId,
	source: schema.application.source,
	tags: schema.application.tags,
	sourceUrl: schema.application.sourceUrl,
	matchScore: schema.application.matchScore,
	followUpAt: schema.application.followUpAt,
	followUpNote: schema.application.followUpNote,
	contacts: schema.application.contacts,
	activity: sql<
		ApplicationTimelineEntry[]
	>`jsonb_path_query_array(${schema.application.activity}, '$[*] ? (@.type == "stage" || @.type == "interview")')`,
	appliedAt: schema.application.appliedAt,
	createdAt: schema.application.createdAt,
	updatedAt: schema.application.updatedAt,
	laneId: schema.application.laneId,
	// What the fork's filters, sort, columns, cards and saved views read. Kept after upstream's columns so its
	// positional row fixtures still line up. The notes stay out: the detail has them.
	companyId: schema.application.companyId,
	resumeFileUrl: schema.application.resumeFileUrl,
	coverLetterUrl: schema.application.coverLetterUrl,
	foundBy: schema.application.foundBy,
	searchFit: schema.application.searchFit,
	searchAt: schema.application.searchAt,
	targetingBuildStatus: schema.application.targetingBuildStatus,
	targetingFit: schema.application.targetingFit,
	targetingReviews: schema.application.targetingReviews,
	targetingPrimaryLane: schema.application.targetingPrimaryLane,
	targetingSecondaryLane: schema.application.targetingSecondaryLane,
	targetingAt: schema.application.targetingAt,
	targetingQuestions: schema.application.targetingQuestions,
};

export const applicationService = {
	list: async (input: {
		userId: string;
		status?: ApplicationStatus;
		laneId?: string;
		tags?: string[];
		limit?: number;
		offset?: number;
	}) => {
		const where = and(
			eq(schema.application.userId, input.userId),
			input.status ? eq(schema.application.status, input.status) : undefined,
			input.laneId ? eq(schema.application.laneId, input.laneId) : undefined,
			input.tags && input.tags.length > 0 ? arrayContains(schema.application.tags, input.tags) : undefined,
		);
		// Bulk imports share an update timestamp; the ID keeps their pages stable.
		const query = db
			.select(listColumns)
			.from(schema.application)
			.where(where)
			.orderBy(sql`${schema.application.updatedAt} desc nulls last`, desc(schema.application.id));
		const paged = input.limit !== undefined || input.offset !== undefined;
		const [rows, totals] = await Promise.all([
			paged ? query.limit(input.limit ?? 20).offset(input.offset ?? 0) : query,
			paged ? db.select({ total: count() }).from(schema.application).where(where) : undefined,
		]);

		return {
			items: rows.map((row) => stripUserId({ ...row, targetingNotes: null })),
			total: totals?.[0]?.total ?? rows.length,
		};
	},

	listSummary: async (input: {
		userId: string;
		status?: ApplicationStatus;
		laneId?: string;
		tags?: string[];
		limit?: number;
		offset?: number;
		includeInitialDetails?: number;
	}) => {
		const where = and(
			eq(schema.application.userId, input.userId),
			input.status ? eq(schema.application.status, input.status) : undefined,
			input.laneId ? eq(schema.application.laneId, input.laneId) : undefined,
			input.tags && input.tags.length > 0 ? arrayContains(schema.application.tags, input.tags) : undefined,
		);
		const query = db
			.select(applicationSummarySelect)
			.from(schema.application)
			.where(where)
			.orderBy(sql`${schema.application.updatedAt} desc nulls last`, desc(schema.application.id));
		const paged = input.limit !== undefined || input.offset !== undefined;
		const [rows, totals] = await Promise.all([
			paged ? query.limit(input.limit ?? 20).offset(input.offset ?? 0) : query,
			paged ? db.select({ total: count() }).from(schema.application).where(where) : undefined,
		]);

		const items = rows.map(stripUserId);
		const initialDetailCount = input.includeInitialDetails ?? 0;
		if (initialDetailCount === 0 || items.length === 0) {
			return { items, total: totals?.[0]?.total ?? rows.length };
		}

		// Web keeps SQL order within each stage. Mobile differs only when the cutoff
		// falls inside a timestamp tie, so only that group needs an ID sort.
		const stageOrder: readonly ApplicationStatus[] = ["interview", "offer", "screening", "applied", "saved", "closed"];
		const buckets = new Map<ApplicationStatus, typeof items>();
		for (const item of items) {
			if (item.status === "closed" && input.status === undefined) continue;
			const bucket = buckets.get(item.status);
			if (bucket) bucket.push(item);
			else buckets.set(item.status, [item]);
		}
		const webCandidates = stageOrder.flatMap((status) => buckets.get(status) ?? []).slice(0, initialDetailCount);
		const candidateIds = new Set(webCandidates.map((item) => item.id));
		const boundary = webCandidates.at(-1);
		if (boundary) {
			const sameGroup = (item: (typeof items)[number]) =>
				item.status === boundary.status && item.updatedAt.getTime() === boundary.updatedAt.getTime();
			const mobileCount = webCandidates.filter(sameGroup).length;
			const tied = items.filter(sameGroup);
			for (const item of tied.toSorted((a, b) => a.id.localeCompare(b.id)).slice(0, mobileCount)) {
				candidateIds.add(item.id);
			}
		}
		if (candidateIds.size === 0) return { items, total: totals?.[0]?.total ?? rows.length };

		// Fetch candidates together so the initial response adds one bounded query, never one query per row.
		const fullRows = await db
			.select()
			.from(schema.application)
			.where(and(eq(schema.application.userId, input.userId), inArray(schema.application.id, [...candidateIds])));
		const details = new Map(fullRows.map((row) => [row.id, stripUserId(row)]));
		return {
			items: items.map((item) => {
				const initialDetail = details.get(item.id);
				return initialDetail ? { ...item, initialDetail } : item;
			}),
			total: totals?.[0]?.total ?? rows.length,
		};
	},

	priorNoResponse: (input: { userId: string; company: string; excludeId?: string | undefined }) => {
		const at =
			sql<Date>`coalesce((select max((entry->>'at')::timestamptz) from jsonb_array_elements(${schema.application.activity}) entry
   where entry->>'type' = 'stage' and entry->>'closedReason' = 'no-response'), ${schema.application.updatedAt})`.mapWith(
				schema.application.updatedAt,
			);
		return db
			.select({ id: schema.application.id, company: schema.application.company, role: schema.application.role, at })
			.from(schema.application)
			.where(
				and(
					eq(schema.application.userId, input.userId),
					sql`lower(regexp_replace(trim(${schema.application.company}), '\\s+', ' ', 'g')) = lower(regexp_replace(trim(${input.company}), '\\s+', ' ', 'g'))`,
					input.excludeId ? sql`${schema.application.id} <> ${input.excludeId}` : undefined,
					sql`((${schema.application.status} = 'closed' and ${schema.application.closedReason} = 'no-response') or exists
     (select 1 from jsonb_array_elements(${schema.application.activity}) entry where entry->>'type' = 'stage' and entry->>'closedReason' = 'no-response'))`,
				),
			)
			.orderBy(desc(at), schema.application.id)
			.limit(10);
	},

	getById: async (input: { id: string; userId: string }) => {
		return stripUserId(await requireOwned(input.id, input.userId));
	},

	create: async (
		input: EditableFields &
			DocumentFiles & {
				userId: string;
				company: string;
				role: string;
				status?: ApplicationStatus | undefined;
				laneId?: string | undefined;
				closedReason?: ApplicationClosedReason | null | undefined;
				stageEnteredAt?: string | undefined;
			},
	) => {
		const { userId, status, laneId, stageEnteredAt, closedReason, resumeFile, coverLetterFile, ...given } = input;
		const fields = stampAssessments(given, new Date());
		const id = generateId();
		await assertOwnedResume(userId, fields.resumeId);
		await assertOwnedCoverLetter(userId, fields.coverLetterId);
		return withDocumentFiles(userId, { resumeFile, coverLetterFile }, (uploadedFields) =>
			db.transaction(async (tx) => {
				await lockUser(tx, userId);
				const { values } = await applicationTransitionValues(
					tx,
					userId,
					{ status, laneId, closedReason },
					undefined,
					stageEnteredAt ? atFromDateString(stageEnteredAt) : new Date(),
				);
				const [row] = await tx
					.insert(schema.application)
					.values({
						id,
						userId,
						...fields,
						...(fields.targetingQuestions?.length
							? {
									targetingQuestions: mergeTargetingQuestions(
										[],
										fields.targetingQuestions,
										await settledTopicsElsewhere(tx, userId),
									),
								}
							: {}),
						...uploadedFields,
						...values,
					})
					.returning();
				if (row) await recordSentResume(await linkApplicationDirectory(tx, row), tx);
				return id;
			}),
		);
	},
	importMany: async (input: {
		userId: string;
		items: (EditableFields & {
			company: string;
			role: string;
			status?: ApplicationStatus | undefined;
			laneId?: string | undefined;
			closedReason?: ApplicationClosedReason | null | undefined;
			stageEnteredAt?: string | undefined;
		})[];
	}) => {
		if (!input.items.length) return { imported: 0 };
		await assertOwnedResumes(
			input.userId,
			input.items.map((item) => item.resumeId),
		);
		const coverLetterIds = new Set(input.items.map((item) => item.coverLetterId).filter((id) => !!id));
		await Promise.all([...coverLetterIds].map((id) => assertOwnedCoverLetter(input.userId, id)));
		const now = new Date();
		return db.transaction(async (tx) => {
			await lockUser(tx, input.userId);
			const pipeline = await ensureApplicationPipeline(tx, input.userId);
			const settled = input.items.some((item) => item.targetingQuestions?.length)
				? await settledTopicsElsewhere(tx, input.userId)
				: new Map<string, SettledTopic>();
			const values = [];
			for (const { status, laneId, closedReason, stageEnteredAt, ...given } of input.items) {
				const fields = stampAssessments(given, now);
				const transition = await applicationTransitionValues(
					tx,
					input.userId,
					{ status, laneId, closedReason },
					undefined,
					stageEnteredAt ? atFromDateString(stageEnteredAt) : new Date(),
					pipeline,
				);
				values.push({
					id: generateId(),
					userId: input.userId,
					...fields,
					...(fields.targetingQuestions?.length
						? { targetingQuestions: mergeTargetingQuestions([], fields.targetingQuestions, settled) }
						: {}),
					...transition.values,
				});
			}
			const rows = await tx.insert(schema.application).values(values).returning();
			for (const row of rows) await recordSentResume(await linkApplicationDirectory(tx, row), tx);
			return { imported: rows.length };
		});
	},

	update: async (
		input: EditableFields &
			DocumentFiles & {
				id: string;
				userId: string;
				canDeleteAttachments?: boolean;
				status?: ApplicationStatus | undefined;
				laneId?: string | undefined;
				stageEnteredAt?: string | undefined;
				closedReason?: ApplicationClosedReason | null | undefined;
			},
	) => {
		const existing = await requireOwned(input.id, input.userId);

		const {
			id,
			userId,
			status,
			laneId,
			stageEnteredAt,
			closedReason,
			resumeFile,
			coverLetterFile,
			canDeleteAttachments = false,
			...given
		} = input;
		const fields = stampAssessments(given, new Date());
		const assertAttachmentPermission = (current: typeof existing) => {
			if (
				!canDeleteAttachments &&
				((current.resumeFileUrl &&
					(resumeFile || (fields.resumeFileUrl !== undefined && fields.resumeFileUrl !== current.resumeFileUrl))) ||
					(current.coverLetterUrl &&
						(coverLetterFile ||
							(fields.coverLetterUrl !== undefined && fields.coverLetterUrl !== current.coverLetterUrl))))
			)
				throw new ORPCError("FORBIDDEN", {
					message: "Replacing or removing an attachment requires api:delete permission.",
				});
		};
		assertAttachmentPermission(existing);
		if (
			(existing.sentResumeVersionId && fields.resumeId !== undefined && fields.resumeId !== existing.resumeId) ||
			(existing.sentCoverLetterVersionId &&
				fields.coverLetterId !== undefined &&
				fields.coverLetterId !== existing.coverLetterId)
		) {
			throw new ORPCError("BAD_REQUEST", {
				message:
					"Recorded submitted documents cannot be replaced. Prepare a copy to keep the submitted versions intact.",
			});
		}
		await assertOwnedResume(userId, fields.resumeId);
		await assertOwnedCoverLetter(userId, fields.coverLetterId);

		return withDocumentFiles(userId, { resumeFile, coverLetterFile }, async (uploadedFields) => {
			const result = await db.transaction(async (tx) => {
				await lockUser(tx, userId);
				const [current] = await tx
					.select()
					.from(schema.application)
					.where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)))
					.for("update");
				if (!current) throw new ORPCError("NOT_FOUND");
				assertAttachmentPermission(current);
				if (
					(current.sentResumeVersionId && fields.resumeId !== undefined && fields.resumeId !== current.resumeId) ||
					(current.sentCoverLetterVersionId &&
						fields.coverLetterId !== undefined &&
						fields.coverLetterId !== current.coverLetterId)
				)
					throw new ORPCError("BAD_REQUEST", {
						message:
							"Recorded submitted documents cannot be replaced. Prepare a copy to keep the submitted versions intact.",
					});
				const { values, transition } = await applicationTransitionValues(
					tx,
					userId,
					{ status, laneId, closedReason },
					current,
					stageEnteredAt ? atFromDateString(stageEnteredAt) : new Date(),
				);
				if (
					!transition.changed &&
					Object.values(fields).every((value) => value === undefined) &&
					Object.keys(uploadedFields).length === 0
				)
					return stripUserId(current);
				const [updated] = await tx
					.update(schema.application)
					.set({
						...fields,
						...(fields.targetingQuestions !== undefined
							? {
									targetingQuestions: mergeTargetingQuestions(
										current.targetingQuestions,
										fields.targetingQuestions,
										await settledTopicsElsewhere(tx, userId, id),
									),
								}
							: {}),
						...(fields.company !== undefined && fields.company !== current.company && fields.companyId === undefined
							? { companyId: null }
							: {}),
						...uploadedFields,
						...values,
					})
					.where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)))
					.returning();

				if (!updated) throw new ORPCError("NOT_FOUND");
				if (current.status === "saved" && SENT_STAGES.has(updated.status))
					await snapshotSentAnswers(tx, userId, updated.id);
				const linked = await linkApplicationDirectory(tx, updated);
				// Editing metadata must not mark a linked draft as submitted.
				const result =
					transition.canonicalTransition || fields.resumeId !== undefined || fields.coverLetterId !== undefined
						? await recordSentResume(linked, tx)
						: linked;
				return stripUserId(result);
			});
			if (fields.resumeFileUrl !== undefined || fields.coverLetterUrl !== undefined || resumeFile || coverLetterFile) {
				await deleteApplicationAttachments(userId, [existing]).catch(() => {});
			}
			return result;
		});
	},

	attachDocument: (input: {
		id: string;
		userId: string;
		kind: ApplicationDocumentKind;
		file: File;
		canDeleteAttachments?: boolean;
	}) => {
		const fields = documentFields(input.kind);
		return applicationService.update({
			id: input.id,
			userId: input.userId,
			[fields.file]: input.file,
			canDeleteAttachments: input.canDeleteAttachments ?? false,
		});
	},

	removeDocument: (input: { id: string; userId: string; kind: ApplicationDocumentKind }) => {
		const fields = documentFields(input.kind);
		return applicationService.update({
			id: input.id,
			userId: input.userId,
			[fields.url]: null,
			[fields.name]: null,
			canDeleteAttachments: true,
		});
	},

	// Persist AI-owned enrichment (match score + freeform metadata). Separate from the editable
	// update path so these fields are only ever written by the AI procedures.
	setAiResult: async (input: {
		id: string;
		userId: string;
		matchScore?: number | null;
		aiMetadata?: AiMetadata | null;
	}) => {
		const [updated] = await db
			.update(schema.application)
			.set({
				...(input.matchScore !== undefined ? { matchScore: input.matchScore } : {}),
				...(input.aiMetadata !== undefined ? { aiMetadata: input.aiMetadata } : {}),
			})
			.where(and(eq(schema.application.id, input.id), eq(schema.application.userId, input.userId)))
			.returning();

		if (!updated) throw new ORPCError("NOT_FOUND");
		return stripUserId(updated);
	},

	/**
	 * Answers, sets aside or reopens one targeting question. Answering or setting it aside does the same to open questions
	 * with its topic on the user's other applications. Reopening clears the answer here only; a saved fact stays in
	 * Knowledge.
	 */
	updateQuestion: (input: {
		id: string;
		userId: string;
		questionId: string;
		status: TargetingQuestionStatus;
		answer?: string | null | undefined;
		factId?: string | null | undefined;
	}) =>
		db.transaction(async (tx) => {
			// One user's questions change together, so two answers to the same topic can't cross.
			await lockUser(tx, input.userId);
			const [current] = await tx
				.select()
				.from(schema.application)
				.where(and(eq(schema.application.id, input.id), eq(schema.application.userId, input.userId)))
				.for("update");
			if (!current) throw new ORPCError("NOT_FOUND");
			if (!current.targetingQuestions.some((question) => question.id === input.questionId))
				throw new ORPCError("NOT_FOUND", { message: "That question isn't on this application." });
			const open = input.status === "open";
			const targetingQuestions = current.targetingQuestions.map((question) =>
				question.id !== input.questionId
					? question
					: {
							...question,
							status: input.status,
							answer: open ? null : (input.answer ?? question.answer),
							factId: open ? null : (input.factId ?? question.factId),
							answeredAt: open ? null : new Date().toISOString(),
							answeredOn: null,
						},
			);
			const [updated] = await tx
				.update(schema.application)
				.set({ targetingQuestions })
				.where(and(eq(schema.application.id, input.id), eq(schema.application.userId, input.userId)))
				.returning();
			if (!updated) throw new ORPCError("NOT_FOUND");

			// The same topic on the user's other applications is the same question: close it there too.
			const closed = targetingQuestions.find((question) => question.id === input.questionId);
			if (!open && closed?.topic) {
				const others = await tx
					.select({ id: schema.application.id, questions: schema.application.targetingQuestions })
					.from(schema.application)
					.where(
						and(
							eq(schema.application.userId, input.userId),
							sql`${schema.application.id} <> ${input.id}`,
							sql`${schema.application.targetingQuestions} @> ${JSON.stringify([{ topic: closed.topic, status: "open" }])}::jsonb`,
						),
					)
					.for("update");
				for (const other of others) {
					await tx
						.update(schema.application)
						.set({
							targetingQuestions: other.questions.map((question) =>
								question.topic === closed.topic && question.status === "open"
									? {
											...question,
											status: closed.status,
											answer: closed.answer,
											factId: closed.factId,
											answeredAt: closed.answeredAt,
											answeredOn: { applicationId: current.id, company: current.company },
										}
									: question,
							),
						})
						.where(eq(schema.application.id, other.id));
				}
			}
			return stripUserId(updated);
		}),

	addNote: async (input: { id: string; userId: string; text: string; date?: string | undefined }) => {
		// Append in a single statement (activity || [event]) so concurrent notes can't drop each
		// other via read-then-write; ownership is enforced by the WHERE clause.
		const event = noteEntry(input.text, input.date);
		const [updated] = await db
			.update(schema.application)
			.set({ activity: sql`${schema.application.activity} || ${JSON.stringify([event])}::jsonb` })
			.where(and(eq(schema.application.id, input.id), eq(schema.application.userId, input.userId)))
			.returning();

		if (!updated) throw new ORPCError("NOT_FOUND");
		return stripUserId(updated);
	},

	addInterview: (input: InterviewDetails & { id: string; userId: string; at: string }) => {
		const { id, userId, at, ...details } = input;
		const event = interviewEntry(at, details);
		return db.transaction(async (tx) => {
			await lockDirectoryOwner(tx, userId);
			const [updated] = await tx
				.update(schema.application)
				.set({ activity: sql`${schema.application.activity} || ${JSON.stringify([event])}::jsonb` })
				.where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)))
				.returning();
			if (!updated) throw new ORPCError("NOT_FOUND");
			return stripUserId(await linkApplicationDirectory(tx, updated));
		});
	},

	updateInterview: (
		input: Partial<{ [K in keyof InterviewDetails]: InterviewDetails[K] | undefined }> & {
			id: string;
			userId: string;
			entryId: string;
			at?: string | undefined;
		},
	) => {
		const { id, userId, entryId, at, ...details } = input;
		const patch = Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));

		return db.transaction(async (tx) => {
			await lockDirectoryOwner(tx, input.userId);
			const [existing] = await tx
				.select()
				.from(schema.application)
				.where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)))
				.for("update");
			if (!existing) throw new ORPCError("NOT_FOUND");

			const target = existing.activity.find((entry) => entry.id === entryId);
			if (!target) throw new ORPCError("NOT_FOUND");
			if (target.type !== "interview") {
				throw new ORPCError("BAD_REQUEST", { message: "Timeline entry is not an interview." });
			}

			const activity = existing.activity.map((entry) =>
				entry.id === entryId ? { ...entry, ...patch, ...(at !== undefined ? { at: interviewAt(at) } : {}) } : entry,
			);

			const [updated] = await tx
				.update(schema.application)
				.set({ activity })
				.where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)))
				.returning();

			if (!updated) throw new ORPCError("NOT_FOUND");
			// Only a new time moves briefings; re-saving the same time would cancel a briefing that's running.
			const moved = at !== undefined && interviewAt(at).getTime() !== new Date(target.at).getTime();
			if (moved) await followInterviewSchedules(tx, userId, id, entryId, interviewAt(at));
			return stripUserId(await linkApplicationDirectory(tx, updated));
		});
	},

	updateTimelineEntry: (input: {
		id: string;
		userId: string;
		entryId: string;
		date?: string | undefined;
		text?: string | undefined;
	}) => {
		return db.transaction(async (tx) => {
			await lockDirectoryOwner(tx, input.userId);
			const [existing] = await tx
				.select()
				.from(schema.application)
				.where(and(eq(schema.application.id, input.id), eq(schema.application.userId, input.userId)))
				.for("update");
			if (!existing) throw new ORPCError("NOT_FOUND");

			const anchor = currentStageAnchor(existing.activity, existing.status);
			const activity = existing.activity.map((entry) => {
				if (entry.id !== input.entryId) return entry;

				// Interviews hold an exact time; a day-granular date edit here could move them to the wrong local day.
				if (entry.type === "interview") {
					throw new ORPCError("BAD_REQUEST", {
						message: "Interview entries must be edited with updateInterview (update_application_interview).",
					});
				}

				if (entry.type !== "note" && input.text !== undefined) {
					throw new ORPCError("BAD_REQUEST", { message: "Only note timeline entries have editable text." });
				}

				return {
					...entry,
					...(input.date !== undefined ? { at: atFromDateString(input.date, entry.at) } : {}),
					...(entry.type === "note" && input.text !== undefined ? { text: input.text } : {}),
				};
			});

			if (!activity.some((entry) => entry.id === input.entryId)) throw new ORPCError("NOT_FOUND");
			assertCurrentStageAnchorLatest(activity, existing.status, anchor?.id);

			const [updated] = await tx
				.update(schema.application)
				.set({
					activity,
					appliedAt: existing.activity.some(
						(entry) => entry.id === input.entryId && entry.type === "stage" && entry.canonicalTransition === false,
					)
						? existing.appliedAt
						: appliedAtFromTimeline(activity, existing.appliedAt),
				})
				.where(and(eq(schema.application.id, input.id), eq(schema.application.userId, input.userId)))
				.returning();

			if (!updated) throw new ORPCError("NOT_FOUND");
			return stripUserId(updated);
		});
	},

	deleteTimelineEntry: (input: { id: string; userId: string; entryId: string }) => {
		return db.transaction(async (tx) => {
			await lockDirectoryOwner(tx, input.userId);
			const [existing] = await tx
				.select()
				.from(schema.application)
				.where(and(eq(schema.application.id, input.id), eq(schema.application.userId, input.userId)))
				.for("update");
			if (!existing) throw new ORPCError("NOT_FOUND");

			const entry = existing.activity.find((item) => item.id === input.entryId);
			if (!entry) throw new ORPCError("NOT_FOUND");

			const anchor = currentStageAnchor(existing.activity, existing.status);
			if (entry.type === "stage" && anchor?.id === entry.id) {
				throw new ORPCError("BAD_REQUEST", { message: "The current stage can't be deleted. Change the stage first." });
			}

			const activity = existing.activity.filter((item) => item.id !== input.entryId);
			assertCurrentStageAnchorLatest(activity, existing.status, anchor?.id);

			const [updated] = await tx
				.update(schema.application)
				.set({
					activity,
					appliedAt: existing.activity.some(
						(entry) => entry.id === input.entryId && entry.type === "stage" && entry.canonicalTransition === false,
					)
						? existing.appliedAt
						: appliedAtFromTimeline(activity, existing.appliedAt),
				})
				.where(and(eq(schema.application.id, input.id), eq(schema.application.userId, input.userId)))
				.returning();

			if (!updated) throw new ORPCError("NOT_FOUND");
			if (entry.type === "interview") await followInterviewSchedules(tx, input.userId, input.id, entry.id, null);
			return stripUserId(updated);
		});
	},

	delete: async (input: { id: string; userId: string }) => {
		const existing = await requireOwned(input.id, input.userId);
		await deleteApplicationCoaching(input.userId, [input.id]);
		const result = await db.transaction(async (tx) => {
			await lockUser(tx, input.userId);
			return tx
				.delete(schema.application)
				.where(and(eq(schema.application.id, input.id), eq(schema.application.userId, input.userId)))
				.returning({ id: schema.application.id });
		});
		if (result.length === 0) throw new ORPCError("NOT_FOUND");
		await deleteApplicationAttachments(input.userId, [existing]);
	},

	bulkUpdate: (input: {
		userId: string;
		ids: string[];
		status?: ApplicationStatus | undefined;
		laneId?: string | undefined;
		closedReason?: ApplicationClosedReason | null | undefined;
		addTags?: string[] | undefined;
	}) =>
		db.transaction(async (tx) => {
			await lockUser(tx, input.userId);
			const pipeline = await ensureApplicationPipeline(tx, input.userId);
			const scope = and(inArray(schema.application.id, input.ids), eq(schema.application.userId, input.userId));
			const rows = await tx.select().from(schema.application).where(scope).for("update");
			for (const row of rows) {
				const { values, transition } = await applicationTransitionValues(
					tx,
					input.userId,
					input,
					row,
					new Date(),
					pipeline,
				);
				const tags = [...new Set([...row.tags, ...(input.addTags ?? [])])];
				if (!transition.changed && tags.length === row.tags.length) continue;
				const [updated] = await tx
					.update(schema.application)
					.set({ ...values, tags })
					.where(and(eq(schema.application.id, row.id), eq(schema.application.userId, input.userId)))
					.returning();
				// Rows leaving Saved for a sent stage get their written answers saved, like a single move.
				if (updated && row.status === "saved" && SENT_STAGES.has(updated.status))
					await snapshotSentAnswers(tx, input.userId, updated.id);
				if (updated && transition.canonicalTransition) await recordSentResume(updated, tx);
			}
			return { updated: rows.length };
		}),

	bulkDelete: async (input: { userId: string; ids: string[] }) => {
		const existing = await db
			.select()
			.from(schema.application)
			.where(and(inArray(schema.application.id, input.ids), eq(schema.application.userId, input.userId)));
		await deleteApplicationCoaching(
			input.userId,
			existing.map((item) => item.id),
		);
		const rows = await db.transaction(async (tx) => {
			await lockUser(tx, input.userId);
			return tx
				.delete(schema.application)
				.where(and(inArray(schema.application.id, input.ids), eq(schema.application.userId, input.userId)))
				.returning({ id: schema.application.id });
		});
		await deleteApplicationAttachments(
			input.userId,
			existing.filter((application) => rows.some((row) => row.id === application.id)),
		);
		return { deleted: rows.length };
	},

	// Raw counts for Insights; funnel/sankey/tiles are derived client-side from these.
	stats: async (input: { userId: string }) => {
		const scope = eq(schema.application.userId, input.userId);

		const byStage = await db
			.select({ status: schema.application.status, count: sql<number>`count(*)::int` })
			.from(schema.application)
			.where(scope)
			.groupBy(schema.application.status);

		const bySource = await db
			.select({ source: schema.application.source, count: sql<number>`count(*)::int` })
			.from(schema.application)
			.where(scope)
			.groupBy(schema.application.source);

		const total = byStage.reduce((sum, row) => sum + row.count, 0);

		return {
			total,
			byStage,
			bySource: bySource
				.filter((row): row is { source: string; count: number } => !!row.source)
				.sort((a, b) => b.count - a.count),
		};
	},

	listTags: async (input: { userId: string }) => {
		const rows = await db
			.select({ tag: sql<string>`distinct unnest(${schema.application.tags})` })
			.from(schema.application)
			.where(eq(schema.application.userId, input.userId));

		return rows.map((row) => row.tag).sort((a, b) => a.localeCompare(b));
	},
};
