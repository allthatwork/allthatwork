import type { ScreenPreferences } from "./screen";
import type { DbOrTx } from "@reactive-resume/db/client";
import type { BoardRef, BoardSource } from "@reactive-resume/schema/boards";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import {
	boardApiHost,
	boardFromUrl,
	boardPageUrl,
	boardRegionOf,
	boardsInHtml,
	boardSlugGuesses,
} from "@reactive-resume/schema/boards";
import { aiLimitsSchema, careerProfileDataSchema } from "@reactive-resume/schema/career";
import { canonicalOpportunityUrl, plainSnippet } from "../career/scheduling";
import { lockDirectoryOwner, ownedCompany } from "../directory/links";
import { readBuiltinPage } from "../web-access/builtin";
import { BoardError, fetchBoard, fetchGreenhouseDetail, websiteFromPostings } from "./ats";
import { passesPayAndOffice, passesTitleAndPlace } from "./screen";

type Board = typeof tables.jobBoard.$inferSelect;
type StoredPosting = typeof tables.jobBoardPosting.$inferSelect;

/** A board fetched (or tried) within this long is reused, so accounts and runs close together cost one request. */
export const BOARD_REUSE_MS = 3_600_000;
/** Greenhouse job pages read per board and run; the rest wait for the next run. Confirming reads more, once. */
const DETAILS_PER_RUN = 40;
const DETAILS_ON_CONFIRM = 200;

const refOf = (board: Pick<Board, "ats" | "host" | "slug">): BoardRef => ({
	ats: board.ats as BoardRef["ats"],
	region: boardRegionOf(board.host),
	slug: board.slug,
});

/** Runs `work` over `items`, `limit` at a time. */
async function pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = [];
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const index = next++;
				results[index] = await work(items[index] as T);
			}
		}),
	);
	return results;
}

async function preferencesOf(userId: string): Promise<ScreenPreferences> {
	const [row] = await db.select().from(tables.careerProfile).where(eq(tables.careerProfile.userId, userId));
	return careerProfileDataSchema.parse(row?.data ?? {});
}

/**
 * "Reading one job board" (Settings → AI & developer → Web access) for the account the work is for: one board's list
 * of roles, or one of its job pages. A scheduled check uses the limits of the account it runs for.
 */
export async function boardTimeoutMs(userId: string) {
	const [row] = await db
		.select({ aiLimits: tables.careerProfile.aiLimits })
		.from(tables.careerProfile)
		.where(eq(tables.careerProfile.userId, userId));
	return aiLimitsSchema.parse(row?.aiLimits ?? {}).boardFetchTimeoutSeconds * 1000;
}

/** The shared row for a board, created on first use. */
async function boardRow(ref: BoardRef) {
	const host = boardApiHost(ref);
	await db.insert(tables.jobBoard).values({ ats: ref.ats, host, slug: ref.slug }).onConflictDoNothing();
	const [row] = await db
		.select()
		.from(tables.jobBoard)
		.where(and(eq(tables.jobBoard.ats, ref.ats), eq(tables.jobBoard.host, host), eq(tables.jobBoard.slug, ref.slug)));
	if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
	return row;
}

/**
 * Brings one shared board up to date, unless it was checked within the hour (then what's stored is reused). New
 * postings are first seen now, ones still listed are seen again, and open ones no longer listed are closed, with
 * every account's found role for them. A failed fetch only records its error: the board keeps its postings. The fetch
 * gets `timeoutMs`, the time limit of the account asking.
 */
export async function refreshBoard(board: Board, timeoutMs: number): Promise<Board> {
	const now = new Date();
	const [claimed] = await db
		.update(tables.jobBoard)
		.set({ checkedAt: now })
		.where(
			and(
				eq(tables.jobBoard.id, board.id),
				or(isNull(tables.jobBoard.checkedAt), lt(tables.jobBoard.checkedAt, new Date(now.getTime() - BOARD_REUSE_MS))),
			),
		)
		.returning();
	if (!claimed) {
		const [current] = await db.select().from(tables.jobBoard).where(eq(tables.jobBoard.id, board.id));
		return current ?? board;
	}
	let listing: Awaited<ReturnType<typeof fetchBoard>>;
	try {
		listing = await fetchBoard(refOf(board), AbortSignal.timeout(timeoutMs), !board.name);
	} catch (error) {
		const reason = error instanceof BoardError ? error.reason : "unreachable";
		const [failed] = await db
			.update(tables.jobBoard)
			.set({ error: reason })
			.where(eq(tables.jobBoard.id, board.id))
			.returning();
		return failed ?? board;
	}
	const unique = [...new Map(listing.postings.map((posting) => [posting.externalId, posting])).values()];
	const website = websiteFromPostings(unique);
	const greenhouse = board.ats === "greenhouse";
	return db.transaction(async (tx) => {
		for (let i = 0; i < unique.length; i += 400) {
			const chunk = unique.slice(i, i + 400);
			await tx
				.insert(tables.jobBoardPosting)
				.values(chunk.map((posting) => ({ ...posting, boardId: board.id, firstSeenAt: now, lastSeenAt: now })))
				.onConflictDoUpdate({
					target: [tables.jobBoardPosting.boardId, tables.jobBoardPosting.externalId],
					set: {
						title: sql`excluded.title`,
						location: sql`excluded.location`,
						remote: sql`excluded.remote`,
						workplace: sql`excluded.workplace`,
						url: sql`excluded.url`,
						postedAt: sql`excluded.posted_at`,
						lastSeenAt: now,
						closedAt: null,
						// A Greenhouse list carries no pay or text; those come from the job's own page, read once.
						...(greenhouse ? {} : { pay: sql`excluded.pay`, description: sql`excluded.description` }),
					},
				});
		}
		const closed = await tx
			.update(tables.jobBoardPosting)
			.set({ closedAt: now })
			.where(
				and(
					eq(tables.jobBoardPosting.boardId, board.id),
					isNull(tables.jobBoardPosting.closedAt),
					lt(tables.jobBoardPosting.lastSeenAt, now),
				),
			)
			.returning({ id: tables.jobBoardPosting.id });
		if (closed.length)
			await tx
				.update(tables.careerOpportunity)
				.set({ closedAt: now })
				.where(
					and(
						inArray(
							tables.careerOpportunity.postingId,
							closed.map((row) => row.id),
						),
						isNull(tables.careerOpportunity.closedAt),
					),
				);
		// A posting back on the board is open again, and so is its found role.
		await tx
			.update(tables.careerOpportunity)
			.set({ closedAt: null })
			.where(
				and(
					isNotNull(tables.careerOpportunity.closedAt),
					sql`${tables.careerOpportunity.postingId} in (select id from job_board_posting where board_id = ${board.id} and closed_at is null)`,
				),
			);
		const [updated] = await tx
			.update(tables.jobBoard)
			.set({
				fetchedAt: now,
				error: null,
				jobCount: unique.length,
				...(listing.name ? { name: listing.name } : {}),
				...(website ? { website } : {}),
			})
			.where(eq(tables.jobBoard.id, board.id))
			.returning();
		return updated ?? board;
	});
}

/** Reads the Greenhouse job pages these postings still lack (once per job), for pay and full text. */
async function fillGreenhouseDetails(board: Board, postings: StoredPosting[], limit: number, timeoutMs: number) {
	const missing = postings.filter((posting) => !posting.detailFetchedAt).slice(0, limit);
	const ref = refOf(board);
	const filled = await pool(missing, 4, async (posting) => {
		try {
			const detail = await fetchGreenhouseDetail(ref, posting.externalId, AbortSignal.timeout(timeoutMs));
			const [row] = await db
				.update(tables.jobBoardPosting)
				.set({ ...detail, detailFetchedAt: new Date() })
				.where(eq(tables.jobBoardPosting.id, posting.id))
				.returning();
			return row ?? posting;
		} catch {
			// Tried again next run.
			return posting;
		}
	});
	const byId = new Map(filled.map((row) => [row.id, row]));
	return postings.map((posting) => byId.get(posting.id) ?? posting);
}

type Watched = {
	watch: typeof tables.companyBoard.$inferSelect;
	board: Board;
	company: typeof tables.company.$inferSelect;
};

export type FoundRole = { company: Watched["company"]; posting: StoredPosting };

/**
 * The roles on watched boards that pass the user's screen: every open one (`all`, when a board is confirmed), or only
 * those first seen after the board was confirmed. Greenhouse postings get their job page read before the pay and
 * office checks; one that couldn't be read waits for the next run.
 */
async function collectRoles(watched: Watched[], preferences: ScreenPreferences, all: boolean, timeoutMs: number) {
	const found: FoundRole[] = [];
	for (const { watch, board, company } of watched) {
		const open = await db
			.select()
			.from(tables.jobBoardPosting)
			.where(
				and(
					eq(tables.jobBoardPosting.boardId, board.id),
					isNull(tables.jobBoardPosting.closedAt),
					all ? undefined : gt(tables.jobBoardPosting.firstSeenAt, watch.confirmedAt),
				),
			);
		let candidates = open.filter((posting) => passesTitleAndPlace(posting, preferences));
		if (board.ats === "greenhouse")
			candidates = (
				await fillGreenhouseDetails(board, candidates, all ? DETAILS_ON_CONFIRM : DETAILS_PER_RUN, timeoutMs)
			).filter((posting) => posting.detailFetchedAt);
		for (const posting of candidates) if (passesPayAndOffice(posting, preferences)) found.push({ company, posting });
	}
	return found;
}

/** Fills a company's empty website from its board; a website the user set is never replaced. */
async function fillWebsites(watched: Watched[]) {
	for (const { board, company } of watched)
		if (!company.website && board.website)
			await db
				.update(tables.company)
				.set({ website: board.website })
				.where(and(eq(tables.company.id, company.id), isNull(tables.company.website)));
}

/**
 * Saves found roles as New roles, each once per account: a role dismissed, tracked or already waiting stays as it is.
 * Returns how many are new.
 */
export async function saveFoundRoles(tx: DbOrTx, userId: string, found: FoundRole[]) {
	const rows = found.flatMap(({ company, posting }) => {
		const url = canonicalOpportunityUrl(posting.url);
		return url ? [{ url, company, posting }] : [];
	});
	if (!rows.length) return 0;
	const known = new Set(
		(
			await tx
				.select({ url: tables.careerOpportunity.url })
				.from(tables.careerOpportunity)
				.where(
					and(
						eq(tables.careerOpportunity.userId, userId),
						inArray(
							tables.careerOpportunity.url,
							rows.map((row) => row.url),
						),
					),
				)
		).map((row) => row.url),
	);
	let added = 0;
	for (const { url, company, posting } of rows) {
		const values = {
			companyId: company.id,
			postingId: posting.id,
			pay: posting.pay,
			remote: posting.remote,
			postedAt: posting.postedAt,
			closedAt: null,
		};
		await tx
			.insert(tables.careerOpportunity)
			.values({
				userId,
				url,
				source: "board",
				role: posting.title.slice(0, 200),
				company: company.name.slice(0, 200),
				location: posting.location.slice(0, 200),
				snippet: plainSnippet(posting.description),
				description: posting.description,
				...values,
			})
			.onConflictDoUpdate({
				target: [tables.careerOpportunity.userId, tables.careerOpportunity.url],
				// A web find for the same posting gains the board's details; one dismissed or tracked is left alone.
				set: { ...values, source: "board", lastSeenAt: new Date() },
				setWhere: sql`${tables.careerOpportunity.dismissedAt} is null and ${tables.careerOpportunity.trackedApplicationId} is null`,
			});
		if (!known.has(url)) added++;
		known.add(url);
	}
	return added;
}

function watchedBy(userId: string, companyId?: string): Promise<Watched[]> {
	return db
		.select({ watch: tables.companyBoard, board: tables.jobBoard, company: tables.company })
		.from(tables.companyBoard)
		.innerJoin(tables.jobBoard, eq(tables.companyBoard.boardId, tables.jobBoard.id))
		.innerJoin(tables.company, eq(tables.companyBoard.companyId, tables.company.id))
		.where(
			and(
				eq(tables.companyBoard.userId, userId),
				eq(tables.company.userId, userId),
				companyId ? eq(tables.companyBoard.companyId, companyId) : undefined,
			),
		);
}

/**
 * One scheduled board check for one account: refresh every watched board (shared, reused within the hour), then
 * collect the roles first seen since each was confirmed that pass the screen. Boards that failed are named.
 */
export async function checkBoards(userId: string) {
	const [watched, timeoutMs] = await Promise.all([watchedBy(userId), boardTimeoutMs(userId)]);
	const boards = [...new Map(watched.map((row) => [row.board.id, row.board])).values()];
	const fresh = new Map(
		(await pool(boards, 3, (board) => refreshBoard(board, timeoutMs))).map((board) => [board.id, board]),
	);
	const current = watched.map((row) => ({ ...row, board: fresh.get(row.board.id) ?? row.board }));
	await fillWebsites(current);
	const failed = [...new Set(current.filter((row) => row.board.error).map((row) => row.company.name))];
	const found = await collectRoles(current, await preferencesOf(userId), false, timeoutMs);
	return { found, failed };
}

// ---- Directory: finding, confirming and dropping boards ----

export type BoardCandidate = BoardRef & {
	/** The board's own name, when its API gives one (Greenhouse), to compare with the company's. */
	name: string | null;
	jobCount: number;
	/** A few of its open roles, so a board without a name can still be recognised. */
	sample: string[];
	url: string;
};

async function candidate(ref: BoardRef, signal: AbortSignal): Promise<BoardCandidate | null> {
	try {
		const listing = await fetchBoard(ref, signal, true);
		return {
			...ref,
			name: listing.name,
			jobCount: listing.postings.length,
			sample: [...new Set(listing.postings.map((posting) => posting.title))].slice(0, 3),
			url: boardPageUrl(ref),
		};
	} catch {
		return null;
	}
}

const refKey = (ref: BoardRef) => `${ref.ats}:${boardApiHost(ref)}:${ref.slug.toLowerCase()}`;

/** Boards named by the companies' own posting links on file (their applications' posting addresses); all: every company. */
async function detectedRefs(userId: string, companyIds: string[] | "all") {
	if (!companyIds.length) return new Map<string, BoardRef[]>();
	const rows = await db
		.select({ companyId: tables.application.companyId, url: tables.application.sourceUrl })
		.from(tables.application)
		.where(
			and(
				eq(tables.application.userId, userId),
				companyIds === "all"
					? isNotNull(tables.application.companyId)
					: inArray(tables.application.companyId, companyIds),
				isNotNull(tables.application.sourceUrl),
			),
		);
	const byCompany = new Map<string, Map<string, BoardRef>>();
	for (const row of rows) {
		const ref = row.url ? boardFromUrl(row.url) : null;
		if (!ref || !row.companyId) continue;
		const refs = byCompany.get(row.companyId) ?? new Map<string, BoardRef>();
		refs.set(refKey(ref), ref);
		byCompany.set(row.companyId, refs);
	}
	return new Map([...byCompany].map(([id, refs]) => [id, [...refs.values()]]));
}

/** Open roles on boards already stored (shared), without reading them again: null for one never read. */
async function storedJobCounts(refs: BoardRef[]) {
	const counts = new Map<string, number | null>();
	if (!refs.length) return counts;
	const rows = await db
		.select({
			ats: tables.jobBoard.ats,
			host: tables.jobBoard.host,
			slug: tables.jobBoard.slug,
			jobCount: tables.jobBoard.jobCount,
		})
		.from(tables.jobBoard)
		.where(
			inArray(
				tables.jobBoard.slug,
				refs.map((ref) => ref.slug),
			),
		);
	for (const row of rows) counts.set(refKey(refOf(row)), row.jobCount);
	return counts;
}

export type CompanyJobs = {
	/** Watched boards, earliest confirmed first, with their open roles at the last check. */
	watching: (BoardRef & { id: string; source: BoardSource; url: string; jobCount: number | null })[];
	/** The first board a posting link on file points at that isn't watched, with its stored open roles, to watch. */
	found: (BoardRef & { url: string; jobCount: number | null }) | null;
};

export const boardsService = {
	/**
	 * Every company's Jobs state for the Directory list, in one go: watched boards and one found to watch. A found
	 * board's count comes from what's stored; nothing is read live.
	 */
	jobsByCompany: async (userId: string) => {
		const [watched, detected] = await Promise.all([watchedBy(userId), detectedRefs(userId, "all")]);
		const jobs = new Map<string, CompanyJobs>();
		const entry = (companyId: string) => {
			let found = jobs.get(companyId);
			if (!found) {
				found = { watching: [], found: null };
				jobs.set(companyId, found);
			}
			return found;
		};
		const watchedKeys = new Set<string>();
		for (const { watch, board } of watched.toSorted(
			(a, b) => a.watch.confirmedAt.getTime() - b.watch.confirmedAt.getTime(),
		)) {
			const ref = refOf(board);
			entry(watch.companyId).watching.push({
				id: watch.id,
				...ref,
				source: watch.source as BoardSource,
				url: boardPageUrl(ref),
				jobCount: board.jobCount,
			});
			watchedKeys.add(`${watch.companyId}|${refKey(ref)}`);
		}
		const found = new Map<string, BoardRef>();
		for (const [companyId, refs] of detected) {
			const ref = refs.find((item) => !watchedKeys.has(`${companyId}|${refKey(item)}`));
			if (ref) found.set(companyId, ref);
		}
		const counts = await storedJobCounts([...found.values()]);
		for (const [companyId, ref] of found)
			entry(companyId).found = { ...ref, url: boardPageUrl(ref), jobCount: counts.get(refKey(ref)) ?? null };
		return jobs;
	},

	/** A company's watched boards, boards its posting links point at that aren't watched yet, and its saved link. */
	company: async (userId: string, companyId: string) => {
		const company = await ownedCompany(db, userId, companyId);
		const [watched, detected] = await Promise.all([watchedBy(userId, companyId), detectedRefs(userId, [companyId])]);
		const watchedKeys = new Set(watched.map(({ board }) => refKey(refOf(board))));
		const unwatched = (detected.get(companyId) ?? []).filter((ref) => !watchedKeys.has(refKey(ref)));
		const counts = await storedJobCounts(unwatched);
		return {
			watched: watched.map(({ watch, board }) => ({
				id: watch.id,
				...refOf(board),
				source: watch.source as BoardSource,
				confirmedAt: watch.confirmedAt,
				name: board.name,
				jobCount: board.jobCount,
				fetchedAt: board.fetchedAt,
				error: board.error,
				url: boardPageUrl(refOf(board)),
			})),
			detected: unwatched.map((ref) => ({ ...ref, url: boardPageUrl(ref), jobCount: counts.get(refKey(ref)) ?? null })),
			careersUrl: company.careersUrl,
		};
	},

	/**
	 * The boards a pasted link points at: a board or posting address itself, or a careers page that links to or embeds
	 * one. Each is read once to show what it is. A link that leads to none (Workday, iCIMS, a careers page without one),
	 * or a page that can't be opened (such sites often block or time out), is saved as the company's jobs link instead;
	 * it can't be watched. A link that does lead to one but can't be read is an error, and nothing is saved.
	 */
	fromLink: async (userId: string, companyId: string, link: string) => {
		await ownedCompany(db, userId, companyId);
		const signal = AbortSignal.timeout(await boardTimeoutMs(userId));
		let refs: BoardRef[] = [];
		const direct = boardFromUrl(link);
		if (direct) refs = [direct];
		else {
			try {
				const page = await readBuiltinPage(link, signal);
				const resolved = boardFromUrl(page.resolvedUrl);
				refs = resolved ? [resolved] : boardsInHtml(page.html);
			} catch {
				// Unreadable: saved below like any other link we can't watch.
			}
		}
		if (!refs.length) {
			const savedLink = link.trim();
			await db
				.update(tables.company)
				.set({ careersUrl: savedLink })
				.where(and(eq(tables.company.id, companyId), eq(tables.company.userId, userId)));
			return { boards: [], savedLink };
		}
		const boards = (await Promise.all(refs.slice(0, 5).map((ref) => candidate(ref, signal)))).filter(
			(item): item is BoardCandidate => item !== null,
		);
		if (!boards.length)
			throw new ORPCError("BAD_REQUEST", {
				message: "Couldn't read this company's jobs page. Check the link and try again.",
			});
		return { boards, savedLink: null };
	},

	/**
	 * Name guesses, read on Greenhouse, Ashby and Lever (EU hosts too). A guess can land on another company's board,
	 * so these are only shown for confirming.
	 */
	guess: async (userId: string, companyId: string) => {
		const company = await ownedCompany(db, userId, companyId);
		const signal = AbortSignal.timeout(await boardTimeoutMs(userId));
		const refs = boardSlugGuesses(company.name).flatMap((slug): BoardRef[] => [
			{ ats: "greenhouse", region: "us", slug },
			{ ats: "greenhouse", region: "eu", slug },
			{ ats: "ashby", region: "us", slug },
			{ ats: "lever", region: "us", slug },
			{ ats: "lever", region: "eu", slug },
		]);
		const found = await pool(refs, 6, (ref) => candidate(ref, signal));
		return found.filter((item): item is BoardCandidate => item !== null && item.jobCount > 0);
	},

	/**
	 * Watches a board for a company. Its open roles that pass the screen land in New roles now, once; later runs bring
	 * only roles first seen after this. A board that can't be read isn't watched.
	 */
	watch: async (userId: string, input: BoardRef & { companyId: string; source: BoardSource }) => {
		await ownedCompany(db, userId, input.companyId);
		const timeoutMs = await boardTimeoutMs(userId);
		const board = await refreshBoard(await boardRow(input), timeoutMs);
		if (!board.fetchedAt)
			throw new ORPCError("BAD_REQUEST", {
				message: "Couldn't read this company's jobs page. Check the link and try again.",
			});
		const watched = await db.transaction(async (tx) => {
			await lockDirectoryOwner(tx, userId);
			await tx
				.insert(tables.companyBoard)
				.values({ userId, companyId: input.companyId, boardId: board.id, source: input.source })
				.onConflictDoNothing();
			// A watched page replaces a saved link the company had, so it never shows both.
			await tx
				.update(tables.company)
				.set({ careersUrl: null })
				.where(and(eq(tables.company.id, input.companyId), eq(tables.company.userId, userId)));
			const [row] = await tx
				.select()
				.from(tables.companyBoard)
				.where(
					and(
						eq(tables.companyBoard.userId, userId),
						eq(tables.companyBoard.companyId, input.companyId),
						eq(tables.companyBoard.boardId, board.id),
					),
				);
			return row;
		});
		if (!watched) throw new ORPCError("INTERNAL_SERVER_ERROR");
		const rows = await watchedBy(userId, input.companyId);
		const current = rows.filter((row) => row.watch.id === watched.id);
		await fillWebsites(current);
		const found = await collectRoles(current, await preferencesOf(userId), true, timeoutMs);
		const added = await db.transaction((tx) => saveFoundRoles(tx, userId, found));
		return { id: watched.id, added };
	},

	/** Stops watching one board. Roles it already found stay in New roles until dismissed or closed. */
	unwatch: async (userId: string, id: string) => {
		const rows = await db
			.delete(tables.companyBoard)
			.where(and(eq(tables.companyBoard.id, id), eq(tables.companyBoard.userId, userId)))
			.returning();
		if (!rows.length) throw new ORPCError("NOT_FOUND");
	},

	/**
	 * Companies worth watching: those with contacts and no watched board, most contacts first. Where a posting link on
	 * file names the company's board, it's read (reused within the hour) to count its open roles that match.
	 */
	suggestions: async (userId: string) => {
		const ranked = await db
			.select({
				id: tables.company.id,
				name: tables.company.name,
				website: tables.company.website,
				contacts: sql<number>`count(${tables.contact.id})::int`,
			})
			.from(tables.company)
			.innerJoin(
				tables.contact,
				and(eq(tables.contact.companyId, tables.company.id), eq(tables.contact.userId, userId)),
			)
			.where(
				and(
					eq(tables.company.userId, userId),
					sql`not exists (select 1 from company_board where company_board.company_id = ${tables.company.id} and company_board.user_id = ${userId})`,
				),
			)
			.groupBy(tables.company.id)
			.orderBy(desc(sql`count(${tables.contact.id})`), tables.company.name)
			.limit(12);
		const detected = await detectedRefs(
			userId,
			ranked.map((row) => row.id),
		);
		const [preferences, timeoutMs] = await Promise.all([preferencesOf(userId), boardTimeoutMs(userId)]);
		return pool(ranked, 3, async (row) => {
			const ref = detected.get(row.id)?.[0] ?? null;
			if (!ref) return { ...row, board: null, openRoles: null };
			const board = await refreshBoard(await boardRow(ref), timeoutMs);
			if (!board.fetchedAt) return { ...row, board: { ...ref, url: boardPageUrl(ref) }, openRoles: null };
			const open = await db
				.select()
				.from(tables.jobBoardPosting)
				.where(and(eq(tables.jobBoardPosting.boardId, board.id), isNull(tables.jobBoardPosting.closedAt)));
			return {
				...row,
				board: { ...ref, url: boardPageUrl(ref) },
				openRoles: open.filter((posting) => passesTitleAndPlace(posting, preferences)).length,
			};
		});
	},

	/** The account's watched boards for Export everything. Shared board data isn't the account's and stays out. */
	exportData: async (userId: string) =>
		(await watchedBy(userId)).map(({ watch, board }) => ({
			companyId: watch.companyId,
			...refOf(board),
			source: watch.source,
			confirmedAt: watch.confirmedAt,
		})),
};
