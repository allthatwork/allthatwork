import type { DbOrTx } from "@reactive-resume/db/client";
import type { CareerFactCorrection, CareerSource } from "@reactive-resume/schema/career";
import type z from "zod";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ORPCError } from "@orpc/client";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import { buildMarkdown, resumeFactProposals } from "@reactive-resume/resume/markdown";
import { FOUND_BY_IN_APP_SEARCH } from "@reactive-resume/schema/applications/data";
import { formatBoardPay, boardSourceName } from "@reactive-resume/schema/boards";
import {
	careerProfileDataSchema,
	careerImportFactsInputSchema,
	type CareerImportFactsResult,
	careerWorkspaceSchema,
	careerWorkspaceDataSchema,
	EMPTY_WORKSPACE,
	aiLimitsSchema,
	type CareerProfileData,
	type CareerProfileUpdate,
	type CareerWorkspace,
	type AiLimits,
	type careerFactInputSchema,
	type resumeFactsReviewSchema,
	type careerOfferInputSchema,
	type careerStoryInputSchema,
	offerTermsSchema,
	type OfferTerms,
	type SavedItemData,
} from "@reactive-resume/schema/career";
import {
	factPromptChars,
	groupAncestors,
	isPrivateGroup,
	type KnowledgeRules,
	nearestGroupSetting,
	reachesAi,
	findDuplicates,
	normalizeFactText,
	preferredFact,
	storyHolds,
} from "@reactive-resume/utils/knowledge";
import { countryForTimeZone } from "@reactive-resume/utils/region";
import { generateId } from "@reactive-resume/utils/string";
import { requestRunCancellation } from "../agent/cancellation";
import { aiProvidersService } from "../ai-providers/service";
import { assertAiOperations, combineAiUsage, readAiUsages } from "../ai/usage";
import { availableApplicationContext } from "../applications/access";
import { activeApplications } from "../applications/access";
import { ownedFactIds, snapshotSentAnswers } from "../applications/answers";
import { findTrackedPosting } from "../applications/duplicates";
import { syncFollowUp } from "../applications/follow-up";
import { applicationTransitionValues, ensureApplicationPipeline, savedStageOf } from "../applications/lanes";
import { applicationService, assertApplicationVersion, hasSubmitted, recordSentResume } from "../applications/service";
import { linkApplicationDirectory } from "../directory/links";
import { assertSharedDocument, idInUse, isRetriedCreate, lockUser, recordCreateRequest } from "../documents/ownership";
import { parseStoredResumeData } from "../resume/resume-data-validation";
import { matchPosting } from "./matching";
import { noticeText } from "./notices";

type Owned = { userId: string; applicationId?: string | null | undefined };
type FactInput = z.infer<typeof careerFactInputSchema>;
type StoryInput = z.infer<typeof careerStoryInputSchema>;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Older clients omit provenance; their content edits must preserve the recorded request sources. */
function inheritAnswerUsage(answers: CareerWorkspace["answers"], current: CareerWorkspace["answers"]) {
	return answers.map((answer) => {
		const previous = current.find((entry) => entry.id === answer.id);
		return answer.aiOperationIds === undefined && previous?.aiOperationIds !== undefined
			? { ...answer, aiOperationIds: previous.aiOperationIds }
			: answer;
	});
}

const answerOperations = (answers: readonly { aiOperationIds?: string[] | undefined }[]) => [
	...new Set(answers.flatMap((answer) => answer.aiOperationIds ?? [])),
];

const savedItemOperations = (item: { aiOperationId: string | null; data: SavedItemData }) => [
	...new Set([
		...(item.aiOperationId ? [item.aiOperationId] : []),
		...(item.data.kind === "answers" ? answerOperations(item.data.answers) : []),
	]),
];
const visible = (column: typeof tables.careerFact.applicationId, applicationId?: string | null) =>
	applicationId ? or(isNull(column), eq(column, applicationId)) : isNull(column);
const ownedFact = (id: string, userId: string) =>
	and(
		eq(tables.careerFact.id, id),
		and(eq(tables.careerFact.userId, userId), availableApplicationContext(userId, tables.careerFact.applicationId)),
	);
/** Facts in a group, and with `subgroups` in every group under it too. */
const inFactGroup = (group: string, subgroups = true) =>
	subgroups
		? or(eq(tables.careerFact.group, group), sql`starts_with(${tables.careerFact.group}, ${`${group}/`})`)
		: eq(tables.careerFact.group, group);
/** Facts a switch can change: neither forgotten nor archived. */
const switchable = inArray(tables.careerFact.status, ["active", "excluded"]);
const notForgotten = ne(tables.careerFact.status, "forgotten");
type FactSwitch = "active" | "excluded";
type FactStatus = FactSwitch | "archived";
type OverrideRow = typeof tables.careerFactOverride.$inferSelect;
/** Rows hold include or exclude; anything else reads as exclude, the safe side. */
const overrideOf = (row: OverrideRow) => ({
	...row,
	mode: row.mode === "include" ? ("include" as const) : ("exclude" as const),
});

/** How a new fact in this group starts: as the group, or its nearest parent, was last switched. */
async function groupStatus(tx: DbOrTx, userId: string, group: string): Promise<FactSwitch> {
	const rows = await tx
		.select({ group: tables.careerFactGroup.group, status: tables.careerFactGroup.status })
		.from(tables.careerFactGroup)
		.where(
			and(eq(tables.careerFactGroup.userId, userId), inArray(tables.careerFactGroup.group, groupAncestors(group))),
		);
	const settings = new Map(rows.flatMap((row) => (row.status ? [[row.group, row.status] as const] : [])));
	return nearestGroupSetting(group, settings) === "excluded" ? "excluded" : "active";
}

/** Private groups, and in an application, its overrides: what decides reach beyond each fact's own switch. */
async function knowledgeRules(
	userId: string,
	applicationId: string | null | undefined,
	reader: DbOrTx = db,
): Promise<KnowledgeRules> {
	const [groups, overrides] = await Promise.all([
		reader
			.select({ group: tables.careerFactGroup.group })
			.from(tables.careerFactGroup)
			.where(and(eq(tables.careerFactGroup.userId, userId), eq(tables.careerFactGroup.private, true)))
			.orderBy(tables.careerFactGroup.group),
		applicationId
			? reader
					.select({
						group: tables.careerFactOverride.group,
						factId: tables.careerFactOverride.factId,
						mode: tables.careerFactOverride.mode,
					})
					.from(tables.careerFactOverride)
					.where(
						and(
							eq(tables.careerFactOverride.userId, userId),
							eq(tables.careerFactOverride.applicationId, applicationId),
						),
					)
					.orderBy(tables.careerFactOverride.id)
			: Promise.resolve([]),
	]);
	return {
		privateGroups: groups.map((row) => row.group),
		overrides: overrides.map((row) => ({ ...row, mode: row.mode === "include" ? "include" : "exclude" })),
	};
}

/** Independent Facts and Preferences controls must not overwrite fields they don't own. */
export function mergeCareerProfile(stored: CareerProfileData, input: CareerProfileUpdate): CareerProfileData {
	const supplied = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
	return careerProfileDataSchema.parse({ ...stored, ...supplied });
}

export async function requireCareerApplication(input: Owned & { interviewId?: string | null | undefined }) {
	if (!input.applicationId) {
		if (input.interviewId) throw new ORPCError("BAD_REQUEST", { message: "Choose an application for this interview." });
		return null;
	}
	const application = await applicationService.getById({ id: input.applicationId, userId: input.userId });
	if (
		input.interviewId &&
		!application.activity.some((entry) => entry.type === "interview" && entry.id === input.interviewId)
	)
		throw new ORPCError("NOT_FOUND", {
			message: "This interview is no longer part of this application. Choose another interview.",
		});
	return application;
}

/** The text a source holds, and its stored id (a chat message is found by its row or its message id). */
async function sourceText(
	userId: string,
	source: CareerSource,
	applicationId: string | null,
): Promise<{ text: string; id: string }> {
	// Typed or confirmed by the user in the app.
	if (source.kind === "manual" || source.kind === "debrief" || source.kind === "import")
		return { text: source.quote, id: source.id };
	if (source.kind === "user-message") {
		// The coach quotes the saved row; "Remember" on a message in the chat knows only the message's own id.
		const rows = await db
			.select({
				id: tables.agentMessage.id,
				message: tables.agentMessage.uiMessage,
				applicationId: tables.agentThread.applicationId,
			})
			.from(tables.agentMessage)
			.innerJoin(tables.agentThread, eq(tables.agentMessage.threadId, tables.agentThread.id))
			.where(
				and(
					or(eq(tables.agentMessage.id, source.id), sql`${tables.agentMessage.uiMessage}->>'id' = ${source.id}`),
					eq(tables.agentMessage.userId, userId),
					eq(tables.agentMessage.role, "user"),
					isNull(tables.agentThread.deletedAt),
				),
			)
			.limit(2);
		const [row] = rows;
		// An application's conversation backs only facts private to that application; an ambiguous id backs nothing.
		if (!row || rows.length > 1 || (row.applicationId && row.applicationId !== applicationId))
			throw new ORPCError("NOT_FOUND");
		const parts = row.message.parts;
		const text = Array.isArray(parts)
			? parts
					.flatMap((part: { type?: string; text?: string }) => (part.type === "text" ? [part.text ?? ""] : []))
					.join("\n")
			: "";
		return { text, id: row.id };
	}
	if (source.kind === "resume-version") {
		const [row] = await db
			.select()
			.from(tables.resumeVersion)
			.where(and(eq(tables.resumeVersion.id, source.id), eq(tables.resumeVersion.userId, userId)));
		if (!row) throw new ORPCError("NOT_FOUND");
		return { text: buildMarkdown(row.data), id: source.id };
	}
	if (source.kind === "letter-version") {
		const [row] = await db
			.select()
			.from(tables.coverLetterVersion)
			.where(and(eq(tables.coverLetterVersion.id, source.id), eq(tables.coverLetterVersion.userId, userId)));
		if (!row) throw new ORPCError("NOT_FOUND");
		return { text: row.data.content, id: source.id };
	}
	if (source.kind === "resume") {
		const [row] = await db
			.select({ data: tables.resume.data })
			.from(tables.resume)
			.where(and(eq(tables.resume.id, source.id), eq(tables.resume.userId, userId)));
		if (!row) throw new ORPCError("NOT_FOUND");
		return { text: buildMarkdown(row.data), id: source.id };
	}
	if (source.kind === "letter") {
		const [row] = await db
			.select({ content: tables.coverLetter.content })
			.from(tables.coverLetter)
			.where(and(eq(tables.coverLetter.id, source.id), eq(tables.coverLetter.userId, userId)));
		if (!row) throw new ORPCError("NOT_FOUND");
		return { text: row.content, id: source.id };
	}
	throw new ORPCError("BAD_REQUEST", {
		message: "Use a user statement or an owned document as evidence for a career fact.",
	});
}

/** How many stories each fact backs and how many saved items used it. */
const factUsage = {
	stories: sql<number>`(select count(*)::int from ${tables.careerStory} s where s.user_id = ${tables.careerFact.userId} and s.data->'factIds' ? ${tables.careerFact.id})`,
	savedItems: sql<number>`(select count(*)::int from ${tables.careerArtifact} a where a.user_id = ${tables.careerFact.userId} and a.evidence->'factIds' ? ${tables.careerFact.id})`,
};

async function requireFacts(input: Owned, ids: string[], reader: DbOrTx = db) {
	if (!ids.length) return [];
	const [found, rules] = await Promise.all([
		reader
			.select()
			.from(tables.careerFact)
			.where(
				and(
					eq(tables.careerFact.userId, input.userId),
					availableApplicationContext(input.userId, tables.careerFact.applicationId),
					inArray(tables.careerFact.id, ids),
					visible(tables.careerFact.applicationId, input.applicationId),
				),
			),
		knowledgeRules(input.userId, input.applicationId, reader),
	]);
	// A story can only rest on facts that reach the AI where it's used.
	const rows = found.filter((row) => reachesAi(row, rules));
	if (new Set(rows.map((row) => row.id)).size !== new Set(ids).size)
		throw new ORPCError("BAD_REQUEST", {
			message: "Some supporting facts aren't available here. Remove them and try again.",
		});
	return rows;
}

export const modelFact = (fact: typeof tables.careerFact.$inferSelect) => ({
	id: fact.id,
	text: fact.text,
	category: fact.category,
	applicationId: fact.applicationId,
	source: { kind: fact.source.kind, id: fact.source.id },
	updatedAt: fact.updatedAt,
});

async function pipelineRevision(userId: string, reader: DbOrTx) {
	const [pipeline] = await reader
		.select({ revision: tables.applicationPipeline.revision })
		.from(tables.applicationPipeline)
		.where(eq(tables.applicationPipeline.userId, userId));
	return pipeline?.revision ?? 0;
}

async function memoryVersion(userId: string, reader: DbOrTx = db) {
	// New facts can be remembered within a turn; corrections/exclusions invalidate every in-flight draft.
	const revisions = await reader
		.select({
			id: tables.careerFact.id,
			text: tables.careerFact.text,
			status: tables.careerFact.status,
			revisions: tables.careerFact.revisions,
		})
		.from(tables.careerFact)
		.where(
			and(
				and(eq(tables.careerFact.userId, userId), availableApplicationContext(userId, tables.careerFact.applicationId)),
				or(sql`${tables.careerFact.status} <> 'active'`, sql`jsonb_array_length(${tables.careerFact.revisions}) > 0`),
			),
		)
		.orderBy(tables.careerFact.id);
	// Making a group private, or moving a fact into one, hides it everywhere, like an exclusion. An application's own
	// overrides only change that application's Knowledge, which knowledgeVersion covers.
	const groups = await reader
		.select({ group: tables.careerFactGroup.group })
		.from(tables.careerFactGroup)
		.where(and(eq(tables.careerFactGroup.userId, userId), eq(tables.careerFactGroup.private, true)))
		.orderBy(tables.careerFactGroup.group);
	if (!groups.length) return hash(JSON.stringify(revisions));
	const privateGroups = groups.map((row) => row.group);
	const hidden = await reader
		.select({ id: tables.careerFact.id, group: tables.careerFact.group })
		.from(tables.careerFact)
		.where(and(eq(tables.careerFact.userId, userId), sql`${tables.careerFact.group} is not null`))
		.orderBy(tables.careerFact.id);
	return hash(
		JSON.stringify([
			revisions,
			privateGroups,
			hidden.filter((fact) => isPrivateGroup(fact.group, privateGroups)).map((fact) => fact.id),
		]),
	);
}

/** Structured generation is read-only: any change to its Knowledge/preferences invalidates the result. */
function knowledgeSignature(
	profile: z.infer<typeof careerProfileDataSchema>,
	facts: Array<typeof tables.careerFact.$inferSelect>,
	stories: Array<typeof tables.careerStory.$inferSelect>,
	timezone: string,
	rules: KnowledgeRules,
) {
	const hasRules = rules.privateGroups.length > 0 || rules.overrides.length > 0;
	return hash(
		JSON.stringify([
			profile,
			timezone,
			facts
				.map(({ id, applicationId, text, category, status, revisions, source, updatedAt, group }) => ({
					id,
					applicationId,
					text,
					category,
					status,
					revisions,
					source,
					updatedAt,
					// Only when set, so Knowledge without groups keeps the signature it had before groups existed.
					...(group ? { group } : {}),
				}))
				.sort((a, b) => a.id.localeCompare(b.id)),
			stories
				.map(({ id, applicationId, data, updatedAt }) => ({ id, applicationId, data, updatedAt }))
				.sort((a, b) => a.id.localeCompare(b.id)),
			...(hasRules ? [rules] : []),
		]),
	);
}

async function knowledgeVersion(input: Owned, reader: DbOrTx = db) {
	const [[profile], facts, stories, [owner]] = await Promise.all([
		reader.select().from(tables.careerProfile).where(eq(tables.careerProfile.userId, input.userId)),
		reader
			.select()
			.from(tables.careerFact)
			.where(
				and(
					and(
						eq(tables.careerFact.userId, input.userId),
						availableApplicationContext(input.userId, tables.careerFact.applicationId),
					),
					visible(tables.careerFact.applicationId, input.applicationId),
					sql`${tables.careerFact.status} <> 'forgotten'`,
				),
			),
		reader
			.select()
			.from(tables.careerStory)
			.where(
				and(
					and(
						eq(tables.careerStory.userId, input.userId),
						availableApplicationContext(input.userId, tables.careerStory.applicationId),
					),
					input.applicationId
						? or(isNull(tables.careerStory.applicationId), eq(tables.careerStory.applicationId, input.applicationId))
						: isNull(tables.careerStory.applicationId),
				),
			),
		reader.select({ timezone: tables.user.timezone }).from(tables.user).where(eq(tables.user.id, input.userId)),
	]);
	return knowledgeSignature(
		careerProfileDataSchema.parse(profile?.data ?? {}),
		facts,
		stories,
		owner?.timezone ?? "UTC",
		await knowledgeRules(input.userId, input.applicationId, reader),
	);
}

/**
 * A fact changed: stop in-flight coach replies that read the old text. A forgotten fact is also unlinked from
 * stories and saved items, so nothing keeps pointing at it.
 */
async function invalidateMemory(userId: string, id: string, tx: DbOrTx, forgotten = false) {
	if (forgotten) {
		const unlink = (column: typeof tables.careerStory.data | typeof tables.careerArtifact.evidence) =>
			sql`jsonb_set(${column}, '{factIds}', coalesce((select jsonb_agg(f) from jsonb_array_elements(${column}->'factIds') f where f <> to_jsonb(${id}::text)), '[]'::jsonb))`;
		await tx
			.update(tables.careerStory)
			.set({ data: sql`jsonb_set(${tables.careerStory.data}, '{factIds}', '[]'::jsonb)` })
			.where(and(eq(tables.careerStory.userId, userId), sql`${tables.careerStory.data}->'factIds' ? ${id}`));
		await tx
			.update(tables.careerArtifact)
			.set({ evidence: unlink(tables.careerArtifact.evidence) })
			.where(and(eq(tables.careerArtifact.userId, userId), sql`${tables.careerArtifact.evidence}->'factIds' ? ${id}`));
	}
	const threads = await tx
		.select({ runId: tables.agentThread.activeRunId })
		.from(tables.agentThread)
		.where(
			and(
				eq(tables.agentThread.userId, userId),
				// Document conversations too: one may be reading Knowledge right now.
				sql`${tables.agentThread.activeRunId} is not null`,
			),
		);
	await Promise.all(
		threads.flatMap((thread) => (thread.runId ? [requestRunCancellation(thread.runId, "MEMORY_CHANGED")] : [])),
	);
}

type FactRow = typeof tables.careerFact.$inferSelect;

/**
 * A copy private to an application reached that application's AI: make sure the fact it's folded into still does
 * there, with an include override when the shared fact is switched off or private. Returns whether one was added.
 */
async function keepReach(
	tx: DbOrTx,
	userId: string,
	applicationId: string,
	copy: { id: string; status: string; group: string | null },
	twin: FactRow,
) {
	const rules = await knowledgeRules(userId, applicationId, tx);
	if (!reachesAi(copy, rules) || reachesAi(twin, rules)) return false;
	await tx
		.insert(tables.careerFactOverride)
		.values({ userId, applicationId, factId: twin.id, mode: "include" })
		.onConflictDoUpdate({
			target: [tables.careerFactOverride.applicationId, tables.careerFactOverride.factId],
			set: { mode: "include" },
		});
	return true;
}

/** Folds `from` into `into`: stories, saved items and overrides point at `into`, and `from` is archived, not erased. */
async function mergeFacts(tx: DbOrTx, userId: string, from: FactRow, into: FactRow) {
	const swap = (ids: readonly string[]) => [...new Set(ids.map((id) => (id === from.id ? into.id : id)))];
	const stories = await tx
		.select()
		.from(tables.careerStory)
		.where(and(eq(tables.careerStory.userId, userId), sql`${tables.careerStory.data}->'factIds' ? ${from.id}`));
	for (const story of stories)
		await tx
			.update(tables.careerStory)
			.set({ data: { ...story.data, factIds: swap(story.data.factIds) } })
			.where(eq(tables.careerStory.id, story.id));
	const items = await tx
		.select({ id: tables.careerArtifact.id, evidence: tables.careerArtifact.evidence })
		.from(tables.careerArtifact)
		.where(
			and(eq(tables.careerArtifact.userId, userId), sql`${tables.careerArtifact.evidence}->'factIds' ? ${from.id}`),
		);
	for (const item of items)
		await tx
			.update(tables.careerArtifact)
			.set({ evidence: { ...item.evidence, factIds: swap(item.evidence.factIds) } })
			.where(eq(tables.careerArtifact.id, item.id));
	const overrides = await tx
		.select()
		.from(tables.careerFactOverride)
		.where(and(eq(tables.careerFactOverride.userId, userId), eq(tables.careerFactOverride.factId, from.id)));
	for (const override of overrides) {
		const [taken] = await tx
			.select({ id: tables.careerFactOverride.id })
			.from(tables.careerFactOverride)
			.where(
				and(
					eq(tables.careerFactOverride.applicationId, override.applicationId),
					eq(tables.careerFactOverride.factId, into.id),
				),
			);
		if (taken) await tx.delete(tables.careerFactOverride).where(eq(tables.careerFactOverride.id, override.id));
		else
			await tx
				.update(tables.careerFactOverride)
				.set({ factId: into.id })
				.where(eq(tables.careerFactOverride.id, override.id));
	}
	if (from.applicationId) await keepReach(tx, userId, from.applicationId, from, into);
	await tx.update(tables.careerFact).set({ status: "archived" }).where(eq(tables.careerFact.id, from.id));
}

export function hasFitEvidence(context: {
	facts: readonly unknown[];
	stories: readonly unknown[];
	resume: { text: string } | null;
}) {
	return context.facts.length > 0 || context.stories.length > 0 || !!context.resume?.text.trim();
}

/**
 * Records that the user submitted this application: locks the owner, checks the answers and linked documents they
 * confirmed, moves the application to applied, and snapshots what was sent. Callers may already hold the owner lock
 * and the application row; the advisory lock is re-entrant within one transaction. Returns the row and only stage writes committed by this call.
 */
async function submitAnswerSnapshot(
	tx: DbOrTx,
	userId: string,
	applicationId: string,
	answers: CareerWorkspace["answers"],
	expectedAnswers: CareerWorkspace["answers"],
	expectedDocuments?: { resumeId: string | null; coverLetterId: string | null },
) {
	let parsed = careerWorkspaceSchema.shape.answers.parse(answers);
	await lockUser(tx, userId);
	const [application] = await tx
		.select()
		.from(tables.application)
		.where(and(eq(tables.application.id, applicationId), activeApplications(userId)))
		.for("update");
	if (!application) throw new ORPCError("NOT_FOUND");
	if (
		expectedDocuments &&
		(expectedDocuments.resumeId !== application.resumeId ||
			expectedDocuments.coverLetterId !== application.coverLetterId)
	)
		throw new ORPCError("CONFLICT", {
			message: "Selected documents changed elsewhere. Review them before marking as applied.",
		});
	const [workspace] = await tx
		.select()
		.from(tables.careerWorkspace)
		.where(and(eq(tables.careerWorkspace.applicationId, applicationId), eq(tables.careerWorkspace.userId, userId)));
	const current = careerWorkspaceSchema.parse({ ...EMPTY_WORKSPACE, ...workspace?.data });
	parsed = inheritAnswerUsage(parsed, current.answers);
	const reviewedAnswers = inheritAnswerUsage(expectedAnswers, current.answers);
	await assertAiOperations(userId, answerOperations(parsed), ["answer"], tx);
	// A lost success response may be retried only while the committed submission still matches.
	// Draft equality alone also matches a never-submitted application closed in another tab.
	if (application.status !== "saved") {
		const conflict = () =>
			new ORPCError("CONFLICT", {
				message: "This application has changed since submission. Reload it before continuing.",
			});
		const applied = application.activity.findLast(
			(entry) => entry.type === "stage" && entry.stage === "applied" && entry.canonicalTransition !== false,
		);
		if (application.status !== "applied" || !applied || !isDeepStrictEqual(current.answers, parsed)) throw conflict();
		const sent = parsed.filter((answer) => answer.answer.trim());
		if (sent.length) {
			const [snapshot] = await tx
				.select({ id: tables.careerArtifact.id })
				.from(tables.careerArtifact)
				.where(
					and(
						and(
							eq(tables.careerArtifact.userId, userId),
							availableApplicationContext(userId, tables.careerArtifact.applicationId),
						),
						eq(tables.careerArtifact.applicationId, applicationId),
						eq(tables.careerArtifact.inputVersion, hash(JSON.stringify([applicationId, applied.at, sent]))),
					),
				);
			if (!snapshot) throw conflict();
		}
		if (application.resumeId) {
			if (!application.sentResumeVersionId) throw conflict();
			const [version] = await tx
				.select({ id: tables.resumeVersion.id })
				.from(tables.resumeVersion)
				.where(
					and(
						eq(tables.resumeVersion.id, application.sentResumeVersionId),
						eq(tables.resumeVersion.resumeId, application.resumeId),
						eq(tables.resumeVersion.userId, userId),
					),
				);
			if (!version) throw conflict();
		}
		if (application.coverLetterId) {
			if (!application.sentCoverLetterVersionId) throw conflict();
			const [version] = await tx
				.select({ id: tables.coverLetterVersion.id })
				.from(tables.coverLetterVersion)
				.where(
					and(
						eq(tables.coverLetterVersion.id, application.sentCoverLetterVersionId),
						eq(tables.coverLetterVersion.coverLetterId, application.coverLetterId),
						eq(tables.coverLetterVersion.userId, userId),
					),
				);
			if (!version) throw conflict();
		}
		return { application, stages: [] };
	}
	if (!isDeepStrictEqual(current.answers, reviewedAnswers) && !isDeepStrictEqual(current.answers, parsed))
		throw new ORPCError("CONFLICT", {
			message: "Application answers changed elsewhere. Review them before marking as applied.",
		});
	const at = new Date();
	const { values } = await applicationTransitionValues(tx, userId, { status: "applied" }, application, at);
	const [submitted] = await tx
		.update(tables.application)
		.set({
			...values,
		})
		.where(eq(tables.application.id, applicationId))
		.returning();
	if (!submitted) throw new ORPCError("NOT_FOUND");
	const data = careerWorkspaceDataSchema.parse({ ...current, answers: parsed });
	await tx
		.insert(tables.careerWorkspace)
		.values({ applicationId, userId, data })
		.onConflictDoUpdate({ target: tables.careerWorkspace.applicationId, set: { data, updatedAt: at } });
	await recordSentResume(submitted, tx, hasSubmitted(application));
	const sent = parsed.filter((answer) => answer.answer.trim());
	if (sent.length) {
		const [snapshot] = await tx
			.insert(tables.careerArtifact)
			.values({
				userId,
				applicationId,
				interviewId: null,
				title: "Application answers",
				data: { kind: "answers", answers: sent },
				evidence: { factIds: await ownedFactIds(tx, userId, sent), storyIds: [] },
				inputVersion: hash(JSON.stringify([applicationId, at, sent])),
			})
			.returning({ id: tables.careerArtifact.id });
		if (snapshot && !hasSubmitted(application))
			await tx
				.update(tables.careerWorkspace)
				.set({
					submissionReview: sql`jsonb_set(${tables.careerWorkspace.submissionReview}, '{answerVersionId}', ${JSON.stringify(snapshot.id)}::jsonb)`,
					updatedAt: sql`${tables.careerWorkspace.updatedAt}`,
				})
				.where(and(eq(tables.careerWorkspace.applicationId, applicationId), eq(tables.careerWorkspace.userId, userId)));
	}

	return { application: submitted, stages: [savedStageOf(submitted)] };
}

/**
 * Called under the account lock; all fact entry points share suppression and deduplication. A fact in a group starts as
 * the group was last switched, and an application's word-for-word copy of a shared fact folds into the shared one.
 */
async function storeFact(tx: DbOrTx, userId: string, fact: FactInput) {
	const { source } = fact;
	const sourceKey = hash(`${source.kind}:${source.id}:${source.quote.trim().toLocaleLowerCase()}`);
	const [suppressed] = await tx
		.select({ id: tables.careerFact.id })
		.from(tables.careerFact)
		.where(
			and(
				eq(tables.careerFact.userId, userId),
				sql`${tables.careerFact.source}->>'kind' = ${source.kind}`,
				sql`${tables.careerFact.source}->>'id' = ${source.id}`,
				source.kind === "resume" ? eq(tables.careerFact.sourceKey, sourceKey) : undefined,
				or(
					eq(tables.careerFact.status, "forgotten"),
					eq(tables.careerFact.status, "excluded"),
					eq(tables.careerFact.status, "archived"),
					sql`jsonb_array_length(${tables.careerFact.revisions}) > 0`,
				),
			),
		)
		.limit(1);
	if (suppressed) return null;
	const status = fact.group ? await groupStatus(tx, userId, fact.group) : "active";
	if (fact.applicationId) {
		// A word-for-word copy of a shared fact adds nothing: the shared one already reaches this application, or
		// is included for it now, and a later correction to it applies here too.
		const key = normalizeFactText(fact.text);
		const shared = await tx
			.select()
			.from(tables.careerFact)
			.where(and(eq(tables.careerFact.userId, userId), isNull(tables.careerFact.applicationId), switchable));
		const twin = shared.find((row) => normalizeFactText(row.text) === key);
		if (twin) {
			const copy = { id: "", status, group: fact.group ?? null };
			if (await keepReach(tx, userId, fact.applicationId, copy, twin)) await invalidateMemory(userId, twin.id, tx);
			return twin;
		}
	}
	// A forgotten source key remains a content-free tombstone; retries cannot recreate the fact.
	const [row] = await tx
		.insert(tables.careerFact)
		.values({ userId, ...fact, group: fact.group ?? null, status, sourceKey })
		.onConflictDoNothing()
		.returning();
	return row ?? null;
}

async function resumeForFacts(userId: string, resumeId: string, reader: DbOrTx = db) {
	const [row] = await reader
		.select({
			id: tables.resume.id,
			name: tables.resume.name,
			data: tables.resume.data,
			updatedAt: tables.resume.updatedAt,
		})
		.from(tables.resume)
		.where(and(eq(tables.resume.id, resumeId), eq(tables.resume.userId, userId), isNull(tables.resume.trashedAt)));
	if (!row) throw new ORPCError("NOT_FOUND");
	return { ...row, ...resumeFactProposals(parseStoredResumeData(row.data)) };
}

const QUOTE_NOT_IN_SOURCE = "The source does not contain that quotation.";

/** The application fields applying an employer's message owns, as stored on the reply for Undo. */
const appliedFields = (row: typeof tables.application.$inferSelect) => ({
	status: row.status,
	laneId: row.laneId,
	closedReason: row.closedReason,
	followUpAt: row.followUpAt?.toISOString() ?? null,
	followUpNote: row.followUpNote,
	followUpDateOnly: row.followUpDateOnly,
});

export const careerService = {
	memoryVersion,
	/**
	 * The source as it is stored when its text contains the quotation, else null. Ask-first proposals and saves check
	 * the same text, so a proposal never quotes words its source doesn't hold.
	 */
	quotedSource: async (userId: string, source: CareerSource, applicationId: string | null) => {
		const { text, id } = await sourceText(userId, source, applicationId);
		return source.quote.trim() && text.includes(source.quote) ? { ...source, id } : null;
	},
	memoryCutoff: async (userId: string) => {
		const [row] = await db
			.select({ at: tables.careerFact.updatedAt })
			.from(tables.careerFact)
			.where(
				and(
					and(
						eq(tables.careerFact.userId, userId),
						availableApplicationContext(userId, tables.careerFact.applicationId),
					),
					or(sql`${tables.careerFact.status} <> 'active'`, sql`jsonb_array_length(${tables.careerFact.revisions}) > 0`),
				),
			)
			.orderBy(desc(tables.careerFact.updatedAt))
			.limit(1);
		// Making a group private, or moving a fact into one, also keeps older messages out of replays.
		const groups = await db
			.select({ group: tables.careerFactGroup.group, at: tables.careerFactGroup.updatedAt })
			.from(tables.careerFactGroup)
			.where(and(eq(tables.careerFactGroup.userId, userId), eq(tables.careerFactGroup.private, true)));
		if (!groups.length) return row?.at ?? null;
		const privateGroups = groups.map((entry) => entry.group);
		const moved = await db
			.select({ group: tables.careerFact.group, at: tables.careerFact.updatedAt })
			.from(tables.careerFact)
			.where(and(eq(tables.careerFact.userId, userId), sql`${tables.careerFact.group} is not null`));
		const times = [
			row?.at,
			...groups.map((entry) => entry.at),
			...moved.filter((fact) => isPrivateGroup(fact.group, privateGroups)).map((fact) => fact.at),
		].filter((at): at is Date => at instanceof Date);
		return times.reduce((latest, at) => (at > latest ? at : latest));
	},
	profile: async (userId: string) => {
		const [row] = await db.select().from(tables.careerProfile).where(eq(tables.careerProfile.userId, userId));
		return careerProfileDataSchema.parse(row?.data ?? {});
	},
	/** Only untouched UTC accounts adopt a device country. Share the save lock so explicit choices always win. */
	initializeSearchRegions: (userId: string, deviceTimeZone: string) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [row] = await tx
				.select({ data: tables.careerProfile.data, timezone: tables.user.timezone })
				.from(tables.user)
				.leftJoin(tables.careerProfile, eq(tables.careerProfile.userId, tables.user.id))
				.where(eq(tables.user.id, userId));
			const data = careerProfileDataSchema.parse(row?.data ?? {});
			const country = countryForTimeZone(deviceTimeZone);
			if (row?.timezone !== "UTC" || data.searchRegions !== undefined || !country) return data;
			data.searchRegions = [country];
			await tx
				.insert(tables.careerProfile)
				.values({ userId, data })
				.onConflictDoUpdate({ target: tables.careerProfile.userId, set: { data, updatedAt: new Date() } });
			return data;
		}),
	saveProfile: (userId: string, input: CareerProfileUpdate) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [row] = await tx
				.select({ data: tables.careerProfile.data })
				.from(tables.careerProfile)
				.where(eq(tables.careerProfile.userId, userId));
			const data = mergeCareerProfile(careerProfileDataSchema.parse(row?.data ?? {}), input);
			await tx
				.insert(tables.careerProfile)
				.values({ userId, data })
				.onConflictDoUpdate({ target: tables.careerProfile.userId, set: { data, updatedAt: new Date() } });
			return data;
		}),
	aiLimits: async (userId: string) => {
		const [row] = await db
			.select({ aiLimits: tables.careerProfile.aiLimits })
			.from(tables.careerProfile)
			.where(eq(tables.careerProfile.userId, userId));
		return aiLimitsSchema.parse(row?.aiLimits ?? {});
	},
	/** Limits are settings, not preferences: saving them never touches `data` or the Knowledge versions. */
	saveAiLimits: async (userId: string, limits: AiLimits) => {
		await db.transaction(async (tx) => {
			await lockUser(tx, userId);
			await tx
				.insert(tables.careerProfile)
				.values({ userId, data: careerProfileDataSchema.parse({}), aiLimits: limits })
				.onConflictDoUpdate({ target: tables.careerProfile.userId, set: { aiLimits: limits } });
		});
		return limits;
	},
	/** Facts the coach can use for an application (or shared ones). `all` lists every scope, for Knowledge. */
	facts: async (
		input: Owned & { query?: string | undefined; all?: boolean | undefined; group?: string | undefined },
	) => {
		await requireCareerApplication(input);
		const rows = await db
			.select({ fact: tables.careerFact, company: tables.application.company, ...factUsage })
			.from(tables.careerFact)
			.leftJoin(tables.application, eq(tables.application.id, tables.careerFact.applicationId))
			.where(
				and(
					and(
						eq(tables.careerFact.userId, input.userId),
						availableApplicationContext(input.userId, tables.careerFact.applicationId),
					),
					input.all ? undefined : visible(tables.careerFact.applicationId, input.applicationId),
					sql`${tables.careerFact.status} <> 'forgotten'`,
					input.query?.trim()
						? sql`to_tsvector('simple', ${tables.careerFact.text}) @@ plainto_tsquery('simple', ${input.query.trim()})`
						: undefined,
					input.group ? inFactGroup(input.group) : undefined,
				),
			)
			.orderBy(desc(tables.careerFact.createdAt), desc(tables.careerFact.id));
		return rows.map(({ fact, company, stories, savedItems }) => ({
			...fact,
			company,
			usedBy: { stories, savedItems },
		}));
	},
	/** User-reviewed file facts are shared, atomic, and never overwrite or reactivate existing Knowledge. */
	importFacts: (
		userId: string,
		input: z.infer<typeof careerImportFactsInputSchema>,
	): Promise<CareerImportFactsResult> => {
		const { facts } = careerImportFactsInputSchema.parse(input);
		return db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const previous = await tx.select().from(tables.careerFact).where(eq(tables.careerFact.userId, userId));
			const sources = new Map(
				previous.filter((fact) => fact.source.kind === "import").map((fact) => [fact.source.id, fact]),
			);
			const texts = new Map(
				previous
					.filter((fact) => fact.applicationId === null && fact.status !== "forgotten")
					.map((fact) => [normalizeFactText(fact.text), fact]),
			);
			const groups = await tx.select().from(tables.careerFactGroup).where(eq(tables.careerFactGroup.userId, userId));
			const settings = new Map(groups.flatMap((group) => (group.status ? [[group.group, group.status] as const] : [])));
			const results: CareerImportFactsResult["results"] = [];
			for (const inputFact of facts) {
				const original = sources.get(inputFact.source.id);
				const twin = texts.get(normalizeFactText(inputFact.text));
				const existing = original ?? twin;
				if (existing) {
					const suppressed =
						existing.status === "forgotten" ||
						existing.status === "archived" ||
						(Boolean(original) && (existing.status === "excluded" || existing.revisions.length > 0));
					results.push({
						sourceId: inputFact.source.id,
						status: suppressed ? "suppressed" : "duplicate",
						factId: suppressed ? null : existing.id,
					});
					continue;
				}
				const sourceKey = hash(`import:${inputFact.source.id}:${inputFact.source.quote.trim().toLocaleLowerCase()}`);
				const status = nearestGroupSetting(inputFact.group, settings) === "excluded" ? "excluded" : "active";
				const [fact] = await tx
					.insert(tables.careerFact)
					.values({ userId, ...inputFact, applicationId: null, group: inputFact.group ?? null, sourceKey, status })
					.onConflictDoNothing()
					.returning();
				if (!fact) {
					results.push({ sourceId: inputFact.source.id, status: "duplicate", factId: null });
					continue;
				}
				sources.set(inputFact.source.id, fact);
				texts.set(normalizeFactText(fact.text), fact);
				results.push({ sourceId: inputFact.source.id, status: "saved", factId: fact.id });
			}
			return { results };
		});
	},
	/** Project metadata in SQL: even legacy forgotten rows must never leave this boundary with private text. */
	forgottenFacts: (userId: string) =>
		db
			.select({ count: sql<number>`count(*)::integer`, at: tables.careerFact.updatedAt })
			.from(tables.careerFact)
			.where(
				and(
					eq(tables.careerFact.userId, userId),
					availableApplicationContext(userId, tables.careerFact.applicationId),
					eq(tables.careerFact.status, "forgotten"),
				),
			)
			.groupBy(tables.careerFact.updatedAt)
			.orderBy(desc(tables.careerFact.updatedAt)),
	proposeResumeFacts: async (userId: string, resumeId: string) => {
		const { data: _data, ...review } = await resumeForFacts(userId, resumeId);
		return review;
	},
	saveResumeFacts: (userId: string, input: z.infer<typeof resumeFactsReviewSchema>) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			await assertSharedDocument(tx, userId, {
				source: { kind: "resume", id: input.resumeId },
				version: input.updatedAt.toISOString(),
			});
			const resume = await resumeForFacts(userId, input.resumeId, tx);
			const quotes = new Set(resume.proposals.map((proposal) => proposal.quote));
			if (input.proposals.some((proposal) => !quotes.has(proposal.quote)))
				throw new ORPCError("BAD_REQUEST", { message: QUOTE_NOT_IN_SOURCE });
			let saved = 0;
			for (const { quote, ...fact } of input.proposals) {
				const row = await storeFact(tx, userId, {
					...fact,
					applicationId: null,
					source: { kind: "resume", id: resume.id, quote },
				});
				if (row) saved++;
			}
			return { saved, skipped: input.proposals.length - saved };
		}),
	saveFact: async (userId: string, input: FactInput, automatic = false) => {
		if (input.source.kind === "import" && !automatic) {
			if (input.applicationId) throw new ORPCError("BAD_REQUEST", { message: "File imports create shared facts." });
			const { results } = await careerService.importFacts(userId, {
				facts: [{ ...input, source: { ...input.source, kind: "import" } }],
			});
			const result = results[0];
			if (result?.status !== "saved" || !result.factId) return null;
			const [fact] = await db.select().from(tables.careerFact).where(ownedFact(result.factId, userId));
			return fact ?? null;
		}
		const application = await requireCareerApplication({ userId, applicationId: input.applicationId });
		if (automatic && (input.source.kind !== "user-message" || input.text !== input.source.quote))
			throw new ORPCError("BAD_REQUEST", { message: "Automatic memory must quote the user's own words exactly." });
		if (automatic && (await careerService.profile(userId)).memoryMode !== "auto") return null;
		const source = await careerService.quotedSource(userId, input.source, input.applicationId);
		if (!source) throw new ORPCError("BAD_REQUEST", { message: QUOTE_NOT_IN_SOURCE });
		return db.transaction(async (tx) => {
			await lockUser(tx, userId);
			if (application) await assertApplicationVersion(tx, userId, application);
			if (automatic) {
				const [profile] = await tx.select().from(tables.careerProfile).where(eq(tables.careerProfile.userId, userId));
				if (careerProfileDataSchema.parse(profile?.data ?? {}).memoryMode !== "auto") return null;
			}
			return storeFact(tx, userId, { ...input, source });
		});
	},
	updateFact: async (
		userId: string,
		input: {
			id: string;
			text?: string | undefined;
			category?: CareerFactCorrection["category"];
			applicationId?: string | null | undefined;
			before?: CareerFactCorrection["before"] | undefined;
			/** Archived facts never reach the AI and are hidden by default; switching one on or off restores it. */
			status?: FactStatus | undefined;
			share?: boolean | undefined;
			/** Moves the fact to a group, or out of any with null. Its switch stays as it is. */
			group?: string | null | undefined;
		},
	) => {
		const updated = await db.transaction(async (tx) => {
			await lockUser(tx, userId);
			if (input.applicationId) {
				const [application] = await tx
					.select({ id: tables.application.id })
					.from(tables.application)
					.where(and(activeApplications(userId), eq(tables.application.id, input.applicationId)))
					.for("share");
				if (!application) throw new ORPCError("NOT_FOUND");
			}
			const [row] = await tx.select().from(tables.careerFact).where(ownedFact(input.id, userId)).for("update");
			if (!row || row.status === "forgotten") throw new ORPCError("NOT_FOUND");
			if (
				input.before &&
				!isDeepStrictEqual(input.before, {
					text: row.text,
					category: row.category,
					applicationId: row.applicationId,
				})
			)
				throw new ORPCError("CONFLICT", {
					message: "This fact changed. Close the correction and review its current text, type and scope.",
				});
			const text = input.text ?? row.text;
			const category = input.category ?? row.category;
			const applicationId =
				input.applicationId !== undefined ? input.applicationId : input.share ? null : row.applicationId;
			const corrected = text !== row.text || category !== row.category || applicationId !== row.applicationId;
			// A move to another group is a change on its own, even when nothing else is.
			const regrouped = input.group !== undefined && input.group !== row.group;
			if (!corrected && !regrouped && (input.status === undefined || input.status === row.status)) return row;
			const [latestStory] = await tx
				.select({ updatedAt: tables.careerStory.updatedAt })
				.from(tables.careerStory)
				.where(and(eq(tables.careerStory.userId, userId), sql`${tables.careerStory.data}->'factIds' ? ${input.id}`))
				.orderBy(desc(tables.careerStory.updatedAt))
				.limit(1);
			// Corrections must sort after the stories they invalidate, even within one clock tick.
			const updatedAt = new Date(
				Math.max(Date.now(), row.updatedAt.getTime() + 1, (latestStory?.updatedAt.getTime() ?? 0) + 1),
			);
			const [updated] = await tx
				.update(tables.careerFact)
				.set({
					text,
					category,
					applicationId,
					updatedAt,
					...(corrected
						? {
								revisions: [
									...row.revisions,
									{
										text: row.text,
										category: row.category,
										applicationId: row.applicationId,
										at: updatedAt.toISOString(),
									},
								].slice(-50),
							}
						: {}),
					...(input.status ? { status: input.status } : {}),
					...(input.group !== undefined ? { group: input.group } : {}),
				})
				.where(ownedFact(input.id, userId))
				.returning();
			await invalidateMemory(userId, input.id, tx);
			if (!updated) throw new ORPCError("NOT_FOUND");
			return updated;
		});
		return updated;
	},
	forgetFact: async (userId: string, id: string) => {
		await db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [row] = await tx
				.update(tables.careerFact)
				.set({
					text: "",
					status: "forgotten",
					source: sql`jsonb_set(${tables.careerFact.source}, '{quote}', '""'::jsonb)`,
					revisions: [],
				})
				.where(ownedFact(id, userId))
				.returning();
			if (!row) throw new ORPCError("NOT_FOUND");
			await invalidateMemory(userId, id, tx, true);
		});
	},
	/** Switches or regroups many facts at once; forgotten ones are skipped. Returns how many changed. */
	updateFacts: (
		userId: string,
		input: { ids: string[]; status?: FactStatus | undefined; group?: string | null | undefined },
	) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			if (input.status === undefined && input.group === undefined) return { updated: 0 };
			const rows = await tx
				.update(tables.careerFact)
				.set({
					...(input.status ? { status: input.status } : {}),
					...(input.group !== undefined ? { group: input.group } : {}),
				})
				.where(and(eq(tables.careerFact.userId, userId), inArray(tables.careerFact.id, input.ids), notForgotten))
				.returning({ id: tables.careerFact.id });
			if (rows[0]) await invalidateMemory(userId, rows[0].id, tx);
			return { updated: rows.length };
		}),
	/**
	 * Every group with facts or settings, plus ungrouped facts (group null): how many facts are switched on and off, the
	 * size of the shared switched-on ones as actions measure it, and how the group was last switched.
	 */
	factGroups: async (userId: string) => {
		const [facts, settings] = await Promise.all([
			db
				.select({
					id: tables.careerFact.id,
					text: tables.careerFact.text,
					category: tables.careerFact.category,
					status: tables.careerFact.status,
					applicationId: tables.careerFact.applicationId,
					group: tables.careerFact.group,
				})
				.from(tables.careerFact)
				.where(and(eq(tables.careerFact.userId, userId), notForgotten)),
			db.select().from(tables.careerFactGroup).where(eq(tables.careerFactGroup.userId, userId)),
		]);
		const groups = new Map<
			string | null,
			{
				group: string | null;
				status: FactSwitch | null;
				private: boolean;
				facts: { active: number; excluded: number; archived: number };
				activeChars: number;
			}
		>();
		const entry = (group: string | null) => {
			let found = groups.get(group);
			if (!found)
				groups.set(
					group,
					(found = {
						group,
						status: null,
						private: false,
						facts: { active: 0, excluded: 0, archived: 0 },
						activeChars: 0,
					}),
				);
			return found;
		};
		for (const setting of settings) {
			const found = entry(setting.group);
			found.status = setting.status === "active" || setting.status === "excluded" ? setting.status : null;
			found.private = setting.private;
		}
		for (const fact of facts) {
			const group = entry(fact.group);
			if (fact.status === "active") {
				group.facts.active += 1;
				if (fact.applicationId === null) group.activeChars += factPromptChars(fact);
			} else if (fact.status === "archived") group.facts.archived += 1;
			else group.facts.excluded += 1;
		}
		return [...groups.values()].sort((a, b) =>
			a.group === null ? 1 : b.group === null ? -1 : a.group.localeCompare(b.group),
		);
	},
	/**
	 * Switches every fact in a group on or off (with `subgroups`, every group under it too) and remembers it, so facts
	 * added to the group later start the same way. Subgroups switched with it drop their own setting and follow it.
	 */
	setFactGroupStatus: (userId: string, input: { group: string; status: FactSwitch; subgroups: boolean }) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			// Facts already in that state keep their updatedAt, so nothing else counts them as changed.
			const rows = await tx
				.update(tables.careerFact)
				.set({ status: input.status })
				.where(
					and(
						eq(tables.careerFact.userId, userId),
						inFactGroup(input.group, input.subgroups),
						switchable,
						ne(tables.careerFact.status, input.status),
					),
				)
				.returning({ id: tables.careerFact.id });
			await tx
				.insert(tables.careerFactGroup)
				.values({ userId, group: input.group, status: input.status })
				.onConflictDoUpdate({
					target: [tables.careerFactGroup.userId, tables.careerFactGroup.group],
					set: { status: input.status, updatedAt: new Date() },
				});
			if (input.subgroups)
				await tx
					.update(tables.careerFactGroup)
					.set({ status: null })
					.where(
						and(
							eq(tables.careerFactGroup.userId, userId),
							sql`starts_with(${tables.careerFactGroup.group}, ${`${input.group}/`})`,
						),
					);
			if (rows[0]) await invalidateMemory(userId, rows[0].id, tx);
			return { updated: rows.length };
		}),
	/**
	 * Marks a group private, so none of its facts (subgroups included) reach the AI unless an application includes it, or
	 * makes it ordinary again. With `status`, sets how facts added to the group later start, without switching any fact
	 * it holds; subgroups with their own setting keep it.
	 */
	saveFactGroup: (
		userId: string,
		input: { group: string; private?: boolean | undefined; status?: FactSwitch | undefined },
	) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const changes = {
				...(input.private === undefined ? {} : { private: input.private }),
				...(input.status === undefined ? {} : { status: input.status }),
			};
			const [row] = await tx
				.insert(tables.careerFactGroup)
				.values({ userId, group: input.group, ...changes })
				.onConflictDoUpdate({
					target: [tables.careerFactGroup.userId, tables.careerFactGroup.group],
					set: { ...changes, updatedAt: new Date() },
				})
				.returning({
					group: tables.careerFactGroup.group,
					private: tables.careerFactGroup.private,
					status: tables.careerFactGroup.status,
				});
			// Privacy changes what the AI reads; a default for later facts doesn't.
			if (input.private !== undefined) await invalidateMemory(userId, "", tx);
			if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
			const status: FactSwitch | null = row.status === "active" || row.status === "excluded" ? row.status : null;
			return { group: row.group, private: row.private, status };
		}),
	/** Facts the AI can read in this scope: switched on or brought in by the application, and not private. */
	aiFacts: async (input: Owned & { query?: string | undefined }) => {
		const [facts, rules] = await Promise.all([
			careerService.facts(input),
			knowledgeRules(input.userId, input.applicationId),
		]);
		return facts.filter((fact) => reachesAi(fact, rules));
	},
	/** An application's overrides: groups or facts it includes or excludes on top of the global switches. */
	overrides: async (userId: string, applicationId: string) => {
		await requireCareerApplication({ userId, applicationId });
		const rows = await db
			.select()
			.from(tables.careerFactOverride)
			.where(
				and(eq(tables.careerFactOverride.userId, userId), eq(tables.careerFactOverride.applicationId, applicationId)),
			)
			.orderBy(tables.careerFactOverride.createdAt);
		return rows.map(overrideOf);
	},
	/** Includes or excludes a group or a fact for one application, replacing any earlier choice for the same target. */
	saveOverride: async (
		userId: string,
		input: {
			applicationId: string;
			group?: string | undefined;
			factId?: string | undefined;
			mode: "include" | "exclude";
		},
	) => {
		await requireCareerApplication({ userId, applicationId: input.applicationId });
		if ((input.group === undefined) === (input.factId === undefined))
			throw new ORPCError("BAD_REQUEST", { message: "Choose either a group or a fact." });
		return db.transaction(async (tx) => {
			await lockUser(tx, userId);
			if (input.factId) {
				const [fact] = await tx
					.select({ id: tables.careerFact.id })
					.from(tables.careerFact)
					.where(
						and(
							ownedFact(input.factId, userId),
							visible(tables.careerFact.applicationId, input.applicationId),
							switchable,
						),
					);
				if (!fact) throw new ORPCError("NOT_FOUND", { message: "That fact isn't available to this application." });
			}
			const target = input.factId
				? eq(tables.careerFactOverride.factId, input.factId)
				: eq(tables.careerFactOverride.group, input.group ?? "");
			await tx
				.delete(tables.careerFactOverride)
				.where(and(eq(tables.careerFactOverride.applicationId, input.applicationId), target));
			const [row] = await tx
				.insert(tables.careerFactOverride)
				.values({
					userId,
					applicationId: input.applicationId,
					group: input.group ?? null,
					factId: input.factId ?? null,
					mode: input.mode,
				})
				.returning();
			await invalidateMemory(userId, "", tx);
			if (!row) throw new ORPCError("NOT_FOUND");
			return overrideOf(row);
		});
	},
	deleteOverride: (userId: string, id: string) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			await tx
				.delete(tables.careerFactOverride)
				.where(and(eq(tables.careerFactOverride.id, id), eq(tables.careerFactOverride.userId, userId)));
			await invalidateMemory(userId, "", tx);
		}),
	/**
	 * Exact and near duplicates among facts in use, with the one to keep for each exact set (shared over private, switched
	 * on over off, then the oldest) and the texts involved.
	 */
	duplicates: async (userId: string) => {
		const facts = await db
			.select({
				id: tables.careerFact.id,
				text: tables.careerFact.text,
				applicationId: tables.careerFact.applicationId,
				status: tables.careerFact.status,
				group: tables.careerFact.group,
				createdAt: tables.careerFact.createdAt,
				company: tables.application.company,
			})
			.from(tables.careerFact)
			.leftJoin(tables.application, eq(tables.application.id, tables.careerFact.applicationId))
			.where(and(eq(tables.careerFact.userId, userId), switchable));
		const { exact, near } = findDuplicates(facts);
		const involved = new Map<string, (typeof facts)[number]>();
		const sets = exact.flatMap((cluster) => {
			const keep = preferredFact(cluster);
			if (!keep) return [];
			for (const fact of cluster) involved.set(fact.id, fact);
			return [{ keep: keep.id, copies: cluster.filter((fact) => fact.id !== keep.id).map((fact) => fact.id) }];
		});
		const pairs = near.map(({ facts: [a, b], similarity, contained }) => {
			involved.set(a.id, a);
			involved.set(b.id, b);
			return { factIds: [a.id, b.id], similarity, contained };
		});
		return {
			exact: sets,
			near: pairs,
			facts: [...involved.values()].map(({ id, text, applicationId, company, status, group }) => ({
				id,
				text,
				applicationId,
				company,
				status,
				group,
			})),
		};
	},
	/**
	 * Folds one fact into another: its stories, saved items and overrides move to the one kept, and it's archived. When
	 * the one kept is private to an application and the other reached more of them, the one kept becomes shared, so no
	 * application loses the fact; it also takes the other's group if it has none.
	 */
	mergeFact: (userId: string, input: { id: string; into: string }) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			if (input.id === input.into) throw new ORPCError("BAD_REQUEST", { message: "Choose two different facts." });
			const rows = await tx
				.select()
				.from(tables.careerFact)
				.where(and(eq(tables.careerFact.userId, userId), inArray(tables.careerFact.id, [input.id, input.into])))
				.for("update");
			const from = rows.find((row) => row.id === input.id);
			const into = rows.find((row) => row.id === input.into);
			if (!from || !into || from.status === "forgotten" || into.status === "forgotten" || into.status === "archived")
				throw new ORPCError("NOT_FOUND");
			const share = into.applicationId !== null && into.applicationId !== from.applicationId;
			const group = into.group ?? from.group;
			const kept =
				share || group !== into.group
					? ((
							await tx
								.update(tables.careerFact)
								.set({ ...(share ? { applicationId: null } : {}), group })
								.where(eq(tables.careerFact.id, into.id))
								.returning()
						)[0] ?? into)
					: into;
			await mergeFacts(tx, userId, from, kept);
			await invalidateMemory(userId, from.id, tx);
			return { updated: 1 };
		}),
	/**
	 * Removes word-for-word copies of shared facts that sit in applications: each is folded into the shared fact, which
	 * is included for that application when it wouldn't reach it otherwise. Copies among shared facts are left to you.
	 */
	cleanDuplicates: (userId: string) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const facts = await tx
				.select()
				.from(tables.careerFact)
				.where(and(eq(tables.careerFact.userId, userId), switchable));
			let merged = 0;
			for (const cluster of findDuplicates(facts).exact) {
				const keep = preferredFact(cluster);
				if (!keep || keep.applicationId !== null) continue;
				for (const copy of cluster)
					if (copy.applicationId !== null) {
						await mergeFacts(tx, userId, copy, keep);
						merged += 1;
					}
			}
			const [first] = facts;
			if (merged && first) await invalidateMemory(userId, first.id, tx);
			return { updated: merged };
		}),
	stories: async (input: Owned) => {
		await requireCareerApplication(input);
		return db
			.select()
			.from(tables.careerStory)
			.where(
				and(
					and(
						eq(tables.careerStory.userId, input.userId),
						availableApplicationContext(input.userId, tables.careerStory.applicationId),
					),
					input.applicationId
						? or(isNull(tables.careerStory.applicationId), eq(tables.careerStory.applicationId, input.applicationId))
						: isNull(tables.careerStory.applicationId),
				),
			)
			.orderBy(desc(tables.careerStory.updatedAt));
	},
	saveStory: async (userId: string, input: StoryInput, id?: string, expectedMemoryVersion?: string) => {
		const application = await requireCareerApplication({ userId, applicationId: input.applicationId });
		return db.transaction(async (tx) => {
			await lockUser(tx, userId);
			if (application) await assertApplicationVersion(tx, userId, application);
			if (expectedMemoryVersion && expectedMemoryVersion !== (await memoryVersion(userId, tx)))
				throw new ORPCError("CONFLICT", { message: "Career memory changed. Start a fresh reply." });
			const facts = await requireFacts({ userId, applicationId: input.applicationId }, input.factIds, tx);
			const values = {
				applicationId: input.applicationId,
				data: input,
				updatedAt: new Date(Math.max(Date.now(), ...facts.map((fact) => fact.updatedAt.getTime()))),
			};
			const [row] = id
				? await tx
						.update(tables.careerStory)
						.set(values)
						.where(
							and(
								eq(tables.careerStory.id, id),
								and(
									eq(tables.careerStory.userId, userId),
									availableApplicationContext(userId, tables.careerStory.applicationId),
								),
							),
						)
						.returning()
				: await tx
						.insert(tables.careerStory)
						.values({ userId, ...values })
						.returning();
			if (!row) throw new ORPCError("NOT_FOUND");
			return row;
		});
	},
	deleteStory: async (userId: string, id: string) => {
		await db.transaction(async (tx) => {
			await lockUser(tx, userId);
			await tx
				.delete(tables.careerStory)
				.where(
					and(
						eq(tables.careerStory.id, id),
						and(
							eq(tables.careerStory.userId, userId),
							availableApplicationContext(userId, tables.careerStory.applicationId),
						),
					),
				);
		});
	},
	context: async (input: Owned & { interviewId?: string | null | undefined }) => {
		const memoryRevision = await memoryVersion(input.userId);
		const storedApplication = await requireCareerApplication(input);
		const pipeline = storedApplication
			? await db.transaction(async (tx) => {
					await lockUser(tx, input.userId);
					return ensureApplicationPipeline(tx, input.userId);
				})
			: null;
		const lane = pipeline?.lanes.find(
			(lane) =>
				lane.id === storedApplication?.laneId ||
				(!storedApplication?.laneId && lane.systemKey === storedApplication?.status),
		);
		const application = storedApplication ? { ...storedApplication, laneLabel: lane?.label ?? null } : null;
		const [preferences, limits, facts, stories, [owner], rules] = await Promise.all([
			careerService.profile(input.userId),
			careerService.aiLimits(input.userId),
			careerService.facts(input),
			careerService.stories(input),
			db.select({ timezone: tables.user.timezone }).from(tables.user).where(eq(tables.user.id, input.userId)),
			knowledgeRules(input.userId, input.applicationId),
		]);
		// The coach reads times in the user's timezone (Settings → Preferences) with the rest of their preferences.
		const profile = { ...preferences, timezone: owner?.timezone ?? "UTC" };
		const knowledgeRevision = knowledgeSignature(preferences, facts, stories, profile.timezone, rules);
		// Switched on, or brought in by this application, and not in a private group it didn't include.
		const active = facts.filter((fact) => reachesAi(fact, rules));
		let resume: { text: string; version: string; submitted: boolean; source: { kind: string; id: string } } | null =
			null;
		let letter: { text: string; version: string; submitted: boolean; source: { kind: string; id: string } } | null =
			null;
		if (application?.sentResumeVersionId) {
			const [row] = await db
				.select()
				.from(tables.resumeVersion)
				.where(
					and(
						eq(tables.resumeVersion.id, application.sentResumeVersionId),
						eq(tables.resumeVersion.userId, input.userId),
					),
				);
			if (row)
				resume = {
					text: buildMarkdown(row.data),
					version: row.id,
					submitted: true,
					source: { kind: "resume-version", id: row.id },
				};
		} else if (application?.resumeId) {
			const [row] = await db
				.select()
				.from(tables.resume)
				.where(and(eq(tables.resume.id, application.resumeId), eq(tables.resume.userId, input.userId)));
			if (row)
				resume = {
					text: buildMarkdown(row.data),
					version: row.updatedAt.toISOString(),
					submitted: false,
					source: { kind: "resume", id: row.id },
				};
		}
		if (application?.sentCoverLetterVersionId) {
			const [row] = await db
				.select()
				.from(tables.coverLetterVersion)
				.where(
					and(
						eq(tables.coverLetterVersion.id, application.sentCoverLetterVersionId),
						eq(tables.coverLetterVersion.userId, input.userId),
					),
				);
			if (row)
				letter = {
					text: row.data.content,
					version: row.id,
					submitted: true,
					source: { kind: "letter-version", id: row.id },
				};
		} else if (application?.coverLetterId) {
			const [row] = await db
				.select()
				.from(tables.coverLetter)
				.where(and(eq(tables.coverLetter.id, application.coverLetterId), eq(tables.coverLetter.userId, input.userId)));
			if (row)
				letter = {
					text: row.content,
					version: row.updatedAt.toISOString(),
					submitted: false,
					source: { kind: "letter", id: row.id },
				};
		}
		const blockedSources = [
			...(await db
				.select({ source: tables.careerFact.source })
				.from(tables.careerFact)
				.where(
					and(
						eq(tables.careerFact.userId, input.userId),
						availableApplicationContext(input.userId, tables.careerFact.applicationId),
						or(
							sql`${tables.careerFact.status} <> 'active'`,
							sql`jsonb_array_length(${tables.careerFact.revisions}) > 0`,
						),
					),
				)),
			// A document a private fact quotes stays out too, or the AI would read the fact in it.
			...facts.filter((fact) => !reachesAi(fact, rules)).map(({ source }) => ({ source })),
		];
		if (
			blockedSources.some(
				({ source }) =>
					(source.kind === "resume" && source.id === application?.resumeId) ||
					(source.kind === "resume-version" && source.id === application?.sentResumeVersionId),
			)
		)
			resume = null;
		if (
			blockedSources.some(
				({ source }) =>
					(source.kind === "letter" && source.id === application?.coverLetterId) ||
					(source.kind === "letter-version" && source.id === application?.sentCoverLetterVersionId),
			)
		)
			letter = null;
		const interview = input.interviewId
			? (application?.activity.find((entry) => entry.type === "interview" && entry.id === input.interviewId) ?? null)
			: null;
		const activeFacts = active.map(modelFact);
		// A story needs every fact behind it reaching the AI and not corrected since; switching one off and on is no change.
		const usable = new Map(active.map((fact) => [fact.id, fact]));
		const usableStories = stories.filter((story) => storyHolds(story, usable));
		if (memoryRevision !== (await memoryVersion(input.userId)) || knowledgeRevision !== (await knowledgeVersion(input)))
			throw new ORPCError("CONFLICT", { message: "Career memory changed while preparing context. Try again." });
		const version = hash(
			JSON.stringify([
				memoryRevision,
				application?.updatedAt,
				pipeline?.revision,
				profile,
				facts.map((fact) => [fact.id, fact.updatedAt]),
				stories.map((story) => [story.id, story.updatedAt]),
				resume?.version,
				letter?.version,
				...(rules.overrides.length ? [rules.overrides] : []),
			]),
		);
		return {
			application,
			interview,
			profile,
			limits,
			facts: activeFacts,
			stories: usableStories,
			resume,
			letter,
			version,
			memoryVersion: memoryRevision,
			pipelineRevision: pipeline?.revision ?? null,
			knowledgeVersion: knowledgeRevision,
		};
	},
	/** Saved items for one application (or across all of them for one kind), newest first. */
	savedItems: async (
		input: Owned & { kind?: SavedItemData["kind"] | undefined },
		reader: DbOrTx = db,
		contextOverride?: { version: string } | null,
	) => {
		const context = contextOverride ?? (input.applicationId !== undefined ? await careerService.context(input) : null);
		const rows = await reader
			.select({
				item: tables.careerArtifact,
				company: tables.application.company,
				role: tables.application.role,
				activity: tables.application.activity,
				status: tables.application.status,
				closedReason: tables.application.closedReason,
			})
			.from(tables.careerArtifact)
			.leftJoin(tables.application, eq(tables.application.id, tables.careerArtifact.applicationId))
			.where(
				and(
					and(
						eq(tables.careerArtifact.userId, input.userId),
						availableApplicationContext(input.userId, tables.careerArtifact.applicationId),
					),
					input.applicationId === null
						? isNull(tables.careerArtifact.applicationId)
						: input.applicationId
							? eq(tables.careerArtifact.applicationId, input.applicationId)
							: undefined,
					input.kind ? sql`${tables.careerArtifact.data}->>'kind' = ${input.kind}` : undefined,
				),
			)
			.orderBy(desc(tables.careerArtifact.createdAt), desc(tables.careerArtifact.id));
		const usage = await readAiUsages(
			input.userId,
			rows.flatMap(({ item }) => savedItemOperations(item)),
			reader,
		);
		return rows.map(({ item, company, role, activity, status, closedReason }) => {
			// Restore schema key order before hashing: JSONB reorders object keys on disk.
			const parsed =
				item.data.kind === "answers" ? careerWorkspaceSchema.shape.answers.safeParse(item.data.answers) : null;
			const answers = parsed?.success ? parsed.data : null;
			return {
				...item,
				aiUsage: combineAiUsage(savedItemOperations(item).flatMap((id) => usage.get(id) ?? [])),
				// Submission writers hash the answers; generated drafts use the context version.
				submission:
					answers !== null &&
					(item.inputVersion === hash(JSON.stringify(answers)) ||
						(activity ?? []).some(
							(entry) =>
								entry.type === "stage" &&
								entry.stage === "applied" &&
								entry.canonicalTransition !== false &&
								item.inputVersion === hash(JSON.stringify([item.applicationId, entry.at, answers])),
						)),
				application: company === null ? null : { company, role: role ?? "", status, closedReason },
				// Knowledge, the posting or documents changed since it was written.
				outdated: item.data.kind !== "answers" && context !== null && item.inputVersion !== context.version,
			};
		});
	},
	/** The answers the user typed for this application's form, as the Apply tab shows them. */
	workspaceAnswers: async (userId: string, applicationId: string, reader: DbOrTx = db) => {
		const [row] = await reader
			.select({ data: tables.careerWorkspace.data })
			.from(tables.careerWorkspace)
			.where(and(eq(tables.careerWorkspace.applicationId, applicationId), eq(tables.careerWorkspace.userId, userId)));
		const parsed = careerWorkspaceSchema.safeParse({ ...EMPTY_WORKSPACE, ...row?.data });
		if (!parsed.success) return [];
		return parsed.data.answers.map(({ question, answer }) => ({ question, answer }));
	},
	createOffer: async (userId: string, { applicationId, ...terms }: z.infer<typeof careerOfferInputSchema>) => {
		const context = await careerService.context({ userId, applicationId });
		if (!context.application) throw new ORPCError("NOT_FOUND");
		return careerService.saveSavedItem({
			userId,
			applicationId,
			interviewId: null,
			title: `${context.application.company} · ${terms.version === "verbal" ? "Verbal offer" : "Written offer"}`,
			data: { kind: "offer", ...terms, origin: "manual" },
			evidence: { factIds: [], storyIds: [] },
			inputVersion: context.version,
		});
	},
	/**
	 * Corrects a saved offer's terms. `expected` is the copy the user edited: a change made elsewhere since then is a
	 * conflict, never overwritten. Where the terms came from is kept.
	 */
	updateOffer: (
		userId: string,
		id: string,
		terms: OfferTerms,
		expected: OfferTerms,
		newVersion = false,
		newId?: string,
	) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const nextTerms = { ...offerTermsSchema.parse(terms), variablePercent: terms.variablePercent ?? null };
			const expectedTerms = { ...offerTermsSchema.parse(expected), variablePercent: expected.variablePercent ?? null };
			const request = { kind: "offer-version", id, terms: nextTerms, expected: expectedTerms };
			if (newVersion && newId && (await isRetriedCreate(tx, { table: "careerArtifact", id: newId, userId, request }))) {
				const [version] = await tx
					.select()
					.from(tables.careerArtifact)
					.where(
						and(
							eq(tables.careerArtifact.id, newId),
							eq(tables.careerArtifact.userId, userId),
							availableApplicationContext(userId, tables.careerArtifact.applicationId),
						),
					);
				if (!version || version.data.kind !== "offer") throw new ORPCError("NOT_FOUND");
				return version;
			}
			const [row] = await tx
				.select()
				.from(tables.careerArtifact)
				.where(
					and(
						eq(tables.careerArtifact.id, id),
						eq(tables.careerArtifact.userId, userId),
						availableApplicationContext(userId, tables.careerArtifact.applicationId),
					),
				)
				.for("update");
			if (!row || row.data.kind !== "offer") throw new ORPCError("NOT_FOUND");
			const { kind: _kind, origin, editedAt: _editedAt, ...current } = row.data;
			if (
				!isDeepStrictEqual(
					{ ...offerTermsSchema.parse(current), variablePercent: current.variablePercent ?? null },
					expectedTerms,
				)
			)
				throw new ORPCError("CONFLICT", {
					message: "This offer changed elsewhere. Review the latest terms before saving again.",
				});
			const data: SavedItemData = {
				kind: "offer",
				...nextTerms,
				...(origin ? { origin } : {}),
				editedAt: new Date().toISOString(),
			};
			const company = row.title.split(" · ")[0] ?? "";
			if (newVersion) {
				const [version] = await tx
					.insert(tables.careerArtifact)
					.values({
						...(newId ? { id: newId } : {}),
						userId,
						applicationId: row.applicationId,
						interviewId: row.interviewId,
						title: `${company} · ${terms.version === "verbal" ? "Verbal offer" : "Written offer"}`,
						data,
						evidence: row.evidence,
						inputVersion: row.inputVersion,
					})
					.onConflictDoNothing({ target: tables.careerArtifact.id })
					.returning();
				if (!version) throw idInUse();
				if (newId) await recordCreateRequest(tx, { id: newId, userId, request });
				return version;
			}
			const [updated] = await tx
				.update(tables.careerArtifact)
				.set({ data, title: `${company} · ${terms.version === "verbal" ? "Verbal offer" : "Written offer"}` })
				.where(eq(tables.careerArtifact.id, id))
				.returning();
			if (!updated) throw new ORPCError("NOT_FOUND");
			return updated;
		}),
	saveSavedItem: (input: {
		userId: string;
		applicationId: string | null;
		interviewId: string | null;
		title: string;
		data: SavedItemData;
		evidence: { factIds: string[]; storyIds: string[] };
		inputVersion: string;
		aiOperationId?: string;
		jobId?: string;
		jobLease?: string;
		expectedMemoryVersion?: string;
		expectedKnowledgeVersion?: string;
		expectedPipelineRevision?: number | null;
	}) =>
		db.transaction(async (tx) => {
			const { expectedMemoryVersion, expectedKnowledgeVersion, expectedPipelineRevision, jobLease, ...values } = input;
			// User → application → schedule → job. No key update permits unrelated FK inserts for this user.
			await lockUser(tx, input.userId);
			if (input.applicationId === null && (input.data.kind !== "practice" || input.interviewId || input.jobId))
				throw new ORPCError("BAD_REQUEST", {
					message: "Only standalone practice can be saved without an application.",
				});
			const [application] =
				input.applicationId === null
					? []
					: await tx
							.select()
							.from(tables.application)
							.where(and(eq(tables.application.id, input.applicationId), activeApplications(input.userId)))
							.for("update");
			if (input.applicationId !== null && !application) throw new ORPCError("NOT_FOUND");
			if (input.jobId) {
				if (!application || application.status === "closed") return null;
				// Match the schedule editor's lock order. Pausing and publishing cannot pass each other.
				const [job] = await tx
					.select()
					.from(tables.careerJob)
					.where(and(eq(tables.careerJob.id, input.jobId), eq(tables.careerJob.userId, input.userId)));
				if (!job) return null;
				const [schedule] = await tx
					.select()
					.from(tables.careerSchedule)
					.where(eq(tables.careerSchedule.id, job.scheduleId))
					.for("update");
				const [current] = await tx.select().from(tables.careerJob).where(eq(tables.careerJob.id, job.id)).for("update");
				if (
					!schedule?.enabled ||
					!current ||
					current.status !== "running" ||
					current.lease !== jobLease ||
					!current.leaseUntil ||
					current.leaseUntil <= new Date()
				)
					return null;
			}
			if (
				(expectedMemoryVersion !== undefined && expectedMemoryVersion !== (await memoryVersion(input.userId, tx))) ||
				(expectedKnowledgeVersion !== undefined && expectedKnowledgeVersion !== (await knowledgeVersion(input, tx))) ||
				(expectedPipelineRevision !== undefined &&
					expectedPipelineRevision !== (await pipelineRevision(input.userId, tx)))
			)
				throw new ORPCError("CONFLICT", {
					message: "Career knowledge changed while generating this result. Generate it again.",
				});
			const [row] = await tx
				.insert(tables.careerArtifact)
				.values({ ...values, jobId: input.jobId ?? null })
				.onConflictDoNothing()
				.returning();
			return row ?? null;
		}),
	assertMemoryVersion: (
		userId: string,
		expected: string,
		knowledge?: {
			applicationId?: string | null;
			version?: string;
			pipelineRevision?: number | null;
			application?: { id: string; updatedAt: Date };
			documents?: readonly { source: { kind: string; id: string }; version: string }[];
			job?: { id: string; lease: string; providerVersion: string };
			sources?: {
				facts: readonly { id: string; updatedAt: Date }[];
				stories: readonly { id: string; updatedAt: Date }[];
				profile: CareerProfileData & { timezone: string };
			};
		},
		selectedResume?: Pick<typeof tables.resume.$inferSelect, "id" | "data" | "updatedAt">,
		providerId?: string,
		reader?: DbOrTx,
	) => {
		const validate = async (tx: DbOrTx) => {
			if (selectedResume) {
				const [current] = await tx
					.select({ id: tables.resume.id, data: tables.resume.data, updatedAt: tables.resume.updatedAt })
					.from(tables.resume)
					.where(
						and(
							eq(tables.resume.id, selectedResume.id),
							eq(tables.resume.userId, userId),
							isNull(tables.resume.trashedAt),
						),
					)
					.for("share");
				if (!isDeepStrictEqual(current, selectedResume))
					throw new ORPCError("CONFLICT", {
						message: "Selected resume changed while preparing roles. Generate suggestions again.",
					});
			}
			if (
				expected !== (await memoryVersion(userId, tx)) ||
				(knowledge &&
					((knowledge.version !== undefined &&
						knowledge.version !== (await knowledgeVersion({ userId, applicationId: knowledge.applicationId }, tx))) ||
						(knowledge.pipelineRevision !== undefined &&
							knowledge.pipelineRevision !== (await pipelineRevision(userId, tx)))))
			)
				throw new ORPCError("CONFLICT", {
					message: "Career knowledge changed while generating this result. Generate it again.",
				});
			if (knowledge?.application) await assertApplicationVersion(tx, userId, knowledge.application);
			for (const document of knowledge?.documents ?? []) await assertSharedDocument(tx, userId, document);
			if (knowledge?.job) {
				const [job] = await tx
					.select({
						enabled: tables.careerSchedule.enabled,
						aiProviderId: tables.careerSchedule.aiProviderId,
						aiProviderVersion: tables.careerSchedule.aiProviderVersion,
						status: tables.careerJob.status,
						lease: tables.careerJob.lease,
						leaseUntil: tables.careerJob.leaseUntil,
					})
					.from(tables.careerJob)
					.innerJoin(tables.careerSchedule, eq(tables.careerJob.scheduleId, tables.careerSchedule.id))
					.where(and(eq(tables.careerJob.id, knowledge.job.id), eq(tables.careerJob.userId, userId)))
					.for("share");
				if (
					!job?.enabled ||
					!providerId ||
					job.aiProviderId !== providerId ||
					job.aiProviderVersion !== knowledge.job.providerVersion ||
					job.status !== "running" ||
					job.lease !== knowledge.job.lease ||
					!job.leaseUntil ||
					job.leaseUntil <= new Date()
				)
					throw new ORPCError("CONFLICT", { message: "Scheduled work was paused or canceled. Nothing was sent." });
			}
			if (knowledge?.sources) {
				const expectedSources = knowledge.sources;
				const [facts, stories, [profile], [owner]] = await Promise.all([
					tx
						.select({ id: tables.careerFact.id, updatedAt: tables.careerFact.updatedAt })
						.from(tables.careerFact)
						.where(
							and(
								and(
									eq(tables.careerFact.userId, userId),
									availableApplicationContext(userId, tables.careerFact.applicationId),
								),
								visible(tables.careerFact.applicationId, knowledge.applicationId),
								eq(tables.careerFact.status, "active"),
							),
						),
					tx
						.select({ id: tables.careerStory.id, updatedAt: tables.careerStory.updatedAt })
						.from(tables.careerStory)
						.where(
							and(
								and(
									eq(tables.careerStory.userId, userId),
									availableApplicationContext(userId, tables.careerStory.applicationId),
								),
								knowledge.applicationId
									? or(
											isNull(tables.careerStory.applicationId),
											eq(tables.careerStory.applicationId, knowledge.applicationId),
										)
									: isNull(tables.careerStory.applicationId),
							),
						),
					tx.select().from(tables.careerProfile).where(eq(tables.careerProfile.userId, userId)),
					tx.select({ timezone: tables.user.timezone }).from(tables.user).where(eq(tables.user.id, userId)),
				]);
				const changed = (before: readonly { id: string; updatedAt: Date }[], now: { id: string; updatedAt: Date }[]) =>
					before.some(
						(entry) => !now.some((row) => row.id === entry.id && row.updatedAt.getTime() === entry.updatedAt.getTime()),
					);
				if (
					changed(expectedSources.facts, facts) ||
					changed(expectedSources.stories, stories) ||
					!isDeepStrictEqual(
						{ ...careerProfileDataSchema.parse(profile?.data ?? {}), timezone: owner?.timezone ?? "UTC" },
						expectedSources.profile,
					)
				)
					throw new ORPCError("CONFLICT", { message: "Shared Knowledge changed. Start a new reply." });
			}
			if (providerId) await aiProvidersService.assertAvailable({ id: providerId, userId }, tx);
		};
		return reader
			? validate(reader)
			: db.transaction(async (tx) => {
					await lockUser(tx, userId);
					await validate(tx);
				});
	},
	deleteSavedItem: async (userId: string, id: string) => {
		await db
			.delete(tables.careerArtifact)
			.where(
				and(
					eq(tables.careerArtifact.id, id),
					and(
						eq(tables.careerArtifact.userId, userId),
						availableApplicationContext(userId, tables.careerArtifact.applicationId),
					),
				),
			);
	},
	/** Applies the ticked changes of a read employer message. Reaching Applied goes through Mark as applied. */
	applyReply: async (
		userId: string,
		id: string,
		selected: number[],
		submission?: {
			answers: CareerWorkspace["answers"];
			expectedAnswers: CareerWorkspace["answers"];
			expectedDocuments: { resumeId: string | null; coverLetterId: string | null };
		},
	) => {
		const [saved] = await db
			.select()
			.from(tables.careerArtifact)
			.where(
				and(
					eq(tables.careerArtifact.id, id),
					and(
						eq(tables.careerArtifact.userId, userId),
						availableApplicationContext(userId, tables.careerArtifact.applicationId),
					),
				),
			);
		if (!saved?.applicationId || saved.data.kind !== "reply") throw new ORPCError("NOT_FOUND");
		const applicationId = saved.applicationId;
		// A repeat saved no stage; acknowledging the current row could adopt another device's later move.
		if (saved.data.applied) return { stages: [] };
		const context = await careerService.context({ userId, applicationId });
		return db.transaction(async (tx) => {
			await lockUser(tx, userId);
			let [application] = await tx
				.select()
				.from(tables.application)
				.where(and(eq(tables.application.id, applicationId), activeApplications(userId)))
				.for("update");
			if (!application) throw new ORPCError("NOT_FOUND");
			const [item] = await tx
				.select()
				.from(tables.careerArtifact)
				.where(
					and(
						eq(tables.careerArtifact.id, id),
						and(
							eq(tables.careerArtifact.userId, userId),
							availableApplicationContext(userId, tables.careerArtifact.applicationId),
						),
					),
				)
				.for("update");
			if (!item?.applicationId || item.data.kind !== "reply") throw new ORPCError("NOT_FOUND");
			const data = item.data;
			// A retry after a lost success response sees the committed receipt before submitting again.
			if (data.applied) return { stages: [] };

			if (
				selected.some((index) => !Number.isInteger(index) || index < 0 || index >= data.changes.length) ||
				new Set(selected).size !== selected.length
			)
				throw new ORPCError("BAD_REQUEST", { message: "Choose valid proposed changes." });
			if (
				selected.length &&
				(item.inputVersion !== context.version ||
					context.pipelineRevision !== (await pipelineRevision(userId, tx)) ||
					application.updatedAt.getTime() !== context.application?.updatedAt.getTime() ||
					context.memoryVersion !== (await memoryVersion(userId, tx)))
			)
				throw new ORPCError("CONFLICT", {
					message:
						"This application or its knowledge changed since the message was read. Read the message again before applying changes.",
				});
			// A stage move from Saved is one change: the receipt (answers, documents, versions) commits in this same
			// transaction, so a failed or canceled confirmation leaves neither the submission nor the move behind.
			let submissionStages: ReturnType<typeof savedStageOf>[] = [];
			if (submission) {
				const result = await submitAnswerSnapshot(
					tx,
					userId,
					applicationId,
					submission.answers,
					submission.expectedAnswers,
					submission.expectedDocuments,
				);
				application = result.application;
				submissionStages = result.stages;
			}
			const changes = data.changes.filter((_, index) => selected.includes(index));
			const now = new Date();
			let offerId: string | null = null;
			let status = application.status;
			let followUpAt = application.followUpAt;
			let followUpNote = application.followUpNote;
			for (const change of changes) {
				if (change.type === "stage" && change.stage !== application.status) {
					if (application.status === "saved")
						throw new ORPCError("BAD_REQUEST", { message: "Mark the application as applied first." });
					status = change.stage;
				}
				// One change owns the next step, so its reminder and its words can't overwrite each other.
				// The old reminder belonged to the old next step, so a next step with nothing due clears it.
				if (change.type === "follow-up") {
					followUpAt = change.at ? new Date(change.at) : null;
					followUpNote = change.note || followUpNote;
				}
				if (change.type === "offer" && data.offer && !offerId) {
					const [offer] = await tx
						.insert(tables.careerArtifact)
						.values({
							userId,
							applicationId: application.id,
							interviewId: null,
							title: `${application.company} · ${data.offer.version === "verbal" ? "Verbal offer" : "Written offer"}`,
							data: { kind: "offer", ...data.offer, origin: "message" },
							evidence: { factIds: [], storyIds: [] },
							inputVersion: item.inputVersion,
						})
						.returning({ id: tables.careerArtifact.id });
					offerId = offer?.id ?? null;
				}
			}
			const { values, transition } = await applicationTransitionValues(tx, userId, { status }, application, now);
			const [updated] = await tx
				.update(tables.application)
				.set({
					...values,
					followUpAt,
					followUpNote,
					...(changes.some((change) => change.type === "follow-up") ? { followUpDateOnly: false } : {}),
				})
				.where(and(eq(tables.application.id, application.id), activeApplications(userId)))
				.returning();
			if (!updated) throw new ORPCError("NOT_FOUND");
			if (transition.canonicalTransition && !hasSubmitted(application)) await recordSentResume(updated, tx);
			if (changes.some((change) => change.type === "follow-up")) await syncFollowUp(tx, updated);
			const undo = { before: appliedFields(application), after: appliedFields(updated), offerId };
			await tx
				.update(tables.careerArtifact)
				.set({ data: { ...data, applied: { at: now.toISOString(), changes: selected, undo } } })
				.where(eq(tables.careerArtifact.id, id));
			return { stages: updated && transition.changed ? [savedStageOf(updated)] : submissionStages };
		});
	},
	/**
	 * Reverses Apply: the fields it set go back and the offer it saved is removed, only while nothing has changed them
	 * since. Versions recorded as sent stay; they are what the employer received. Undoing twice is a no-op.
	 */
	undoReply: (userId: string, id: string) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [item] = await tx
				.select()
				.from(tables.careerArtifact)
				.where(
					and(
						eq(tables.careerArtifact.id, id),
						and(
							eq(tables.careerArtifact.userId, userId),
							availableApplicationContext(userId, tables.careerArtifact.applicationId),
						),
					),
				)
				.for("update");
			if (!item?.applicationId || item.data.kind !== "reply") throw new ORPCError("NOT_FOUND");
			const { applied, ...data } = item.data;
			if (!applied) return { stages: [] };
			if (!applied.undo)
				throw new ORPCError("BAD_REQUEST", {
					message: "This was applied before Undo was available. Change the application in Applications instead.",
				});
			const { before, after, offerId } = applied.undo;
			const [application] = await tx
				.select()
				.from(tables.application)
				.where(and(eq(tables.application.id, item.applicationId), activeApplications(userId)))
				.for("update");
			if (!application) throw new ORPCError("NOT_FOUND");
			const changed = () =>
				new ORPCError("CONFLICT", {
					message: "This application changed after the update. Change it in Applications instead.",
				});
			if (!isDeepStrictEqual(appliedFields(application), after)) throw changed();
			if (offerId) {
				const [offer] = await tx
					.select({ data: tables.careerArtifact.data })
					.from(tables.careerArtifact)
					.where(
						and(
							eq(tables.careerArtifact.id, offerId),
							and(
								eq(tables.careerArtifact.userId, userId),
								availableApplicationContext(userId, tables.careerArtifact.applicationId),
							),
						),
					)
					.for("update");
				// An offer corrected since is the user's own; a deleted one has nothing left to undo.
				if (offer?.data.kind === "offer" && offer.data.editedAt) throw changed();
				if (offer)
					await tx
						.delete(tables.careerArtifact)
						.where(
							and(
								eq(tables.careerArtifact.id, offerId),
								and(
									eq(tables.careerArtifact.userId, userId),
									availableApplicationContext(userId, tables.careerArtifact.applicationId),
								),
							),
						);
			}
			const { values, transition } = await applicationTransitionValues(
				tx,
				userId,
				{ status: before.status, laneId: before.laneId ?? undefined, closedReason: before.closedReason },
				application,
			);
			// Moving back to Applied is not a new submission: the date sent and what was sent stay as recorded.
			const activity =
				values.activity && before.status === "applied"
					? values.activity.map((entry, index, all) =>
							index === all.length - 1 && entry.type === "stage" ? { ...entry, canonicalTransition: false } : entry,
						)
					: values.activity;
			const [updated] = await tx
				.update(tables.application)
				.set({
					...values,
					...(activity ? { activity } : {}),
					appliedAt: application.appliedAt,
					followUpAt: before.followUpAt ? new Date(before.followUpAt) : null,
					followUpNote: before.followUpNote,
					followUpDateOnly: before.followUpDateOnly,
				})
				.where(eq(tables.application.id, application.id))
				.returning();
			if (!updated) throw new ORPCError("NOT_FOUND");
			await syncFollowUp(tx, updated);
			await tx
				.update(tables.careerArtifact)
				.set({ data: { ...data, applied: null } })
				.where(eq(tables.careerArtifact.id, id));
			return { stages: transition.changed ? [savedStageOf(updated)] : [] };
		}),
	workspace: async (userId: string, applicationId: string) => {
		const application = await requireCareerApplication({ userId, applicationId });
		const [row] = await db
			.select()
			.from(tables.careerWorkspace)
			.where(and(eq(tables.careerWorkspace.applicationId, applicationId), eq(tables.careerWorkspace.userId, userId)));
		const data: CareerWorkspace = careerWorkspaceDataSchema.parse({ ...EMPTY_WORKSPACE, ...row?.data });
		if (row?.submissionReview || (application && hasSubmitted(application)))
			data.submissionReview = row?.submissionReview ?? null;
		return data;
	},
	/** Each widget saves its whole key; keys it doesn't send keep their stored values. */
	saveWorkspace: async (
		userId: string,
		applicationId: string,
		patch: { [K in keyof CareerWorkspace]?: CareerWorkspace[K] | undefined },
		expected: { [K in keyof CareerWorkspace]?: CareerWorkspace[K] | undefined },
	) => {
		if (Object.hasOwn(patch, "submissionReview") || Object.hasOwn(expected, "submissionReview"))
			throw new ORPCError("BAD_REQUEST", { message: "Submission review is read-only." });
		await requireCareerApplication({ userId, applicationId });
		// The application row is the lock, so two saves to different keys can't read the same old copy.
		return db.transaction(async (tx) => {
			const [application] = await tx
				.select()
				.from(tables.application)
				.where(and(eq(tables.application.id, applicationId), activeApplications(userId)))
				.for("update");
			const [row] = await tx
				.select()
				.from(tables.careerWorkspace)
				.where(and(eq(tables.careerWorkspace.applicationId, applicationId), eq(tables.careerWorkspace.userId, userId)));
			if (!application) throw new ORPCError("NOT_FOUND");
			const current: CareerWorkspace = careerWorkspaceDataSchema.parse({ ...EMPTY_WORKSPACE, ...row?.data });
			if (hasSubmitted(application)) {
				if (patch.checklist !== undefined && !isDeepStrictEqual(patch.checklist, current.checklist))
					throw new ORPCError("CONFLICT", { message: "Review checks cannot change after submission." });
			}
			const proposed = patch.answers
				? { ...patch, answers: inheritAnswerUsage(patch.answers, current.answers) }
				: patch;
			const reviewed = expected.answers
				? { ...expected, answers: inheritAnswerUsage(expected.answers, current.answers) }
				: expected;
			for (const key of Object.keys(proposed) as (keyof CareerWorkspace)[]) {
				if (proposed[key] === undefined) continue;
				if (!Object.hasOwn(reviewed, key))
					throw new ORPCError("BAD_REQUEST", {
						message: "Include the previous value for every changed workspace field.",
					});
				if (!isDeepStrictEqual(current[key], reviewed[key]) && !isDeepStrictEqual(current[key], proposed[key]))
					throw new ORPCError("CONFLICT", {
						message:
							"This workspace changed elsewhere. Your draft has not been saved. Review the latest version before trying again.",
					});
			}
			const data = careerWorkspaceDataSchema.parse({
				...current,
				...Object.fromEntries(Object.entries(proposed).filter(([, value]) => value !== undefined)),
			});
			await assertAiOperations(userId, answerOperations(data.answers), ["answer"], tx);
			await tx
				.insert(tables.careerWorkspace)
				.values({ applicationId, userId, data })
				.onConflictDoUpdate({ target: tables.careerWorkspace.applicationId, set: { data, updatedAt: new Date() } });
			return {
				...data,
				...(row?.submissionReview || hasSubmitted(application)
					? { submissionReview: row?.submissionReview ?? null }
					: {}),
			};
		});
	},
	/** The application lock serializes removal with workspace saves; only the unchanged target is removed. */
	deleteWorkspaceAnswer: async (
		userId: string,
		applicationId: string,
		id: string,
		expected: CareerWorkspace["answers"][number],
	) => {
		await requireCareerApplication({ userId, applicationId });
		return db.transaction(async (tx) => {
			const [application] = await tx
				.select()
				.from(tables.application)
				.where(and(eq(tables.application.id, applicationId), activeApplications(userId)))
				.for("update");
			if (!application) throw new ORPCError("NOT_FOUND");
			const [row] = await tx
				.select()
				.from(tables.careerWorkspace)
				.where(and(eq(tables.careerWorkspace.applicationId, applicationId), eq(tables.careerWorkspace.userId, userId)));
			const current = careerWorkspaceDataSchema.parse({ ...EMPTY_WORKSPACE, ...row?.data });
			const answer = current.answers.find((item) => item.id === id);
			if (answer && !isDeepStrictEqual(answer, expected))
				throw new ORPCError("CONFLICT", {
					message: "This answer changed elsewhere. Review its latest version before removing it.",
				});
			const data = answer ? { ...current, answers: current.answers.filter((item) => item.id !== id) } : current;
			if (answer)
				await tx
					.update(tables.careerWorkspace)
					.set({ data, updatedAt: new Date() })
					.where(
						and(eq(tables.careerWorkspace.applicationId, applicationId), eq(tables.careerWorkspace.userId, userId)),
					);
			return {
				...data,
				...(row?.submissionReview || hasSubmitted(application)
					? { submissionReview: row?.submissionReview ?? null }
					: {}),
			};
		});
	},
	/** The submitted answers, document versions and stage are one committed action. */
	submitApplication: (
		userId: string,
		applicationId: string,
		answers: CareerWorkspace["answers"],
		expectedAnswers: CareerWorkspace["answers"],
		expectedDocuments?: { resumeId: string | null; coverLetterId: string | null },
	) => {
		return db.transaction(async (tx) => {
			const { stages } = await submitAnswerSnapshot(
				tx,
				userId,
				applicationId,
				answers,
				expectedAnswers,
				expectedDocuments,
			);
			return { stages };
		});
	},
	/**
	 * Copies the workspace's answers into Saved once the application has been sent (moves out of Saved do it too). A copy
	 * made here never becomes the submission review's answers: they may have been written after the application was sent.
	 */
	snapshotAnswers: (userId: string, applicationId: string) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [application] = await tx
				.select()
				.from(tables.application)
				.where(and(eq(tables.application.id, applicationId), activeApplications(userId)))
				.for("update");
			if (!application) throw new ORPCError("NOT_FOUND");
			if (application.status === "saved")
				throw new ORPCError("BAD_REQUEST", {
					message: "Mark the application as applied before recording sent answers.",
				});
			await snapshotSentAnswers(tx, userId, applicationId, { linkReview: false });
		}),
	/** Saves a discovered role to Applications at Saved, with the posting link and why it matched. */
	trackOpportunity: (userId: string, id: string) => {
		// The opportunity row is the lock: a double click or a second tab returns the same application.
		return db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [opportunity] = await tx
				.select()
				.from(tables.careerOpportunity)
				.where(and(eq(tables.careerOpportunity.id, id), eq(tables.careerOpportunity.userId, userId)))
				.for("update");
			if (!opportunity) throw new ORPCError("NOT_FOUND");
			if (opportunity.trackedApplicationId) return { applicationId: opportunity.trackedApplicationId };
			if (opportunity.dismissedAt)
				throw new ORPCError("CONFLICT", { message: "This role was dismissed. Refresh the review queue." });
			const [profile] = await tx.select().from(tables.careerProfile).where(eq(tables.careerProfile.userId, userId));
			const { matches } = matchPosting(opportunity, careerProfileDataSchema.parse(profile?.data ?? {}));
			const duplicate = await findTrackedPosting(tx, userId, opportunity.url);
			const applicationId = duplicate?.id ?? generateId();
			const board = opportunity.source === "board";
			const { values } = await applicationTransitionValues(tx, userId, { status: "saved" });
			// A posting already tracked is the application this role becomes, as the duplicate posting guard has it.
			const [created] = duplicate
				? []
				: await tx
						.insert(tables.application)
						.values({
							id: applicationId,
							userId,
							company: opportunity.company || new URL(opportunity.url).hostname.replace(/^www\./, ""),
							role: opportunity.role,
							location: opportunity.location || null,
							sourceUrl: opportunity.url,
							jobDescription: opportunity.description || null,
							closesAt: opportunity.closesAt,
							...values,
							foundBy: FOUND_BY_IN_APP_SEARCH,
							...(matches.length ? { searchNotes: `Matched: ${matches.join(" · ")}`, searchAt: new Date() } : {}),
							// A board find carries its pay, its company in the Directory and the board it came from.
							...(board
								? {
										companyId: opportunity.companyId,
										salary: formatBoardPay(opportunity.pay) || null,
										source: boardSourceName(opportunity.url),
									}
								: {}),
						})
						.returning();
			if (board && created) await linkApplicationDirectory(tx, created);
			await tx
				.update(tables.careerOpportunity)
				.set({ trackedApplicationId: applicationId })
				.where(eq(tables.careerOpportunity.id, id));
			return { applicationId };
		});
	},
	exportData: async (userId: string) => {
		const [
			profile,
			profileRow,
			facts,
			stories,
			artifacts,
			schedules,
			notifications,
			threads,
			messages,
			attachments,
			opportunities,
			jobs,
			transcripts,
			workspaces,
			factGroups,
			factOverrides,
			reviews,
			reviewedAnswers,
		] = await Promise.all([
			careerService.profile(userId),
			db
				.select({ aiLimits: tables.careerProfile.aiLimits })
				.from(tables.careerProfile)
				.where(eq(tables.careerProfile.userId, userId)),
			db.select().from(tables.careerFact).where(eq(tables.careerFact.userId, userId)),
			db.select().from(tables.careerStory).where(eq(tables.careerStory.userId, userId)),
			db.select().from(tables.careerArtifact).where(eq(tables.careerArtifact.userId, userId)),
			db.select().from(tables.careerSchedule).where(eq(tables.careerSchedule.userId, userId)),
			db.select().from(tables.careerNotification).where(eq(tables.careerNotification.userId, userId)),
			db
				.select()
				.from(tables.agentThread)
				.where(and(eq(tables.agentThread.userId, userId), isNull(tables.agentThread.deletedAt))),
			// Messages of live conversations only: a deleted conversation's words aren't part of the account any more.
			db
				.select()
				.from(tables.agentMessage)
				.where(
					and(
						eq(tables.agentMessage.userId, userId),
						inArray(
							tables.agentMessage.threadId,
							db
								.select({ id: tables.agentThread.id })
								.from(tables.agentThread)
								.where(and(eq(tables.agentThread.userId, userId), isNull(tables.agentThread.deletedAt))),
						),
					),
				),
			db.select().from(tables.agentAttachment).where(eq(tables.agentAttachment.userId, userId)),
			db.select().from(tables.careerOpportunity).where(eq(tables.careerOpportunity.userId, userId)),
			db.select().from(tables.careerJob).where(eq(tables.careerJob.userId, userId)),
			db.select().from(tables.careerTranscript).where(eq(tables.careerTranscript.userId, userId)),
			db.select().from(tables.careerWorkspace).where(eq(tables.careerWorkspace.userId, userId)),
			db.select().from(tables.careerFactGroup).where(eq(tables.careerFactGroup.userId, userId)),
			db.select().from(tables.careerFactOverride).where(eq(tables.careerFactOverride.userId, userId)),
			db.select().from(tables.careerReview).where(eq(tables.careerReview.userId, userId)),
			db.select().from(tables.careerAnswer).where(eq(tables.careerAnswer.userId, userId)),
		]);
		return {
			profile,
			aiLimits: profileRow[0]?.aiLimits ?? null,
			facts,
			stories,
			artifacts,
			schedules,
			notifications: notifications.map((row) => ({ ...row, ...noticeText(row.notice) })),
			threads,
			messages,
			attachments,
			opportunities,
			jobs,
			transcripts,
			workspaces,
			factGroups,
			factOverrides,
			review: reviews[0]?.data ?? null,
			reviewedAnswers,
		};
	},
};
