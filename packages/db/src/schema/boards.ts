import type { BoardPay } from "@reactive-resume/schema/boards";
import * as pg from "drizzle-orm/pg-core";
import { generateId } from "@reactive-resume/utils/string";
import { user } from "./auth";
import { company } from "./directory";

/**
 * A company's public job board on Greenhouse, Ashby or Lever. Board data is public, so one row serves every account
 * that watches it, and it's fetched once per run however many do.
 */
export const jobBoard = pg.pgTable(
	"job_board",
	{
		id: pg
			.text("id")
			.primaryKey()
			.$defaultFn(() => generateId()),
		/** greenhouse, ashby or lever. */
		ats: pg.text("ats").notNull(),
		slug: pg.text("slug").notNull(),
		/** The API host, which differs for boards on EU hosts. */
		host: pg.text("host").notNull(),
		/** The board's own name, when the API gives one (Greenhouse does). */
		name: pg.text("name"),
		/** The company's website, read from the board's posting links, when they point at it. */
		website: pg.text("website"),
		/** The last attempt, successful or not; within the hour, a run reuses what's stored. */
		checkedAt: pg.timestamp("checked_at", { withTimezone: true }),
		/** The last successful fetch. */
		fetchedAt: pg.timestamp("fetched_at", { withTimezone: true }),
		/** Why the last attempt failed; null once one succeeds. A failing board keeps its postings. */
		error: pg.text("error"),
		jobCount: pg.integer("job_count"),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [pg.uniqueIndex().on(t.ats, t.host, t.slug)],
);

/** One posting on a board, open or closed. Shared like its board. */
export const jobBoardPosting = pg.pgTable(
	"job_board_posting",
	{
		id: pg
			.text("id")
			.primaryKey()
			.$defaultFn(() => generateId()),
		boardId: pg
			.text("board_id")
			.notNull()
			.references(() => jobBoard.id, { onDelete: "cascade" }),
		externalId: pg.text("external_id").notNull(),
		title: pg.text("title").notNull(),
		location: pg.text("location").notNull().default(""),
		remote: pg.boolean("remote").notNull().default(false),
		/** remote, hybrid or onsite, when the board says. */
		workplace: pg.text("workplace"),
		url: pg.text("url").notNull(),
		/** Pay ranges as the board posts them; empty when it posts none. */
		pay: pg.jsonb("pay").notNull().$type<BoardPay[]>().default([]),
		/** The posting's full text. Greenhouse lists leave it out, so it's read per job, once, for roles that pass. */
		description: pg.text("description").notNull().default(""),
		/** Greenhouse: when the job's own page was read for pay and full text. */
		detailFetchedAt: pg.timestamp("detail_fetched_at", { withTimezone: true }),
		postedAt: pg.timestamp("posted_at", { withTimezone: true }),
		firstSeenAt: pg.timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
		lastSeenAt: pg.timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
		/** Set when a fetch no longer lists it; cleared if it comes back. */
		closedAt: pg.timestamp("closed_at", { withTimezone: true }),
	},
	(t) => [pg.uniqueIndex().on(t.boardId, t.externalId), pg.index().on(t.boardId, t.closedAt)],
);

/** A board one account watches for one of its companies. Private: other accounts never see who watches what. */
export const companyBoard = pg.pgTable(
	"company_board",
	{
		id: pg
			.text("id")
			.primaryKey()
			.$defaultFn(() => generateId()),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		companyId: pg
			.text("company_id")
			.notNull()
			.references(() => company.id, { onDelete: "cascade" }),
		boardId: pg
			.text("board_id")
			.notNull()
			.references(() => jobBoard.id, { onDelete: "cascade" }),
		/** How it was found: posting (a posting link on file), link (a pasted careers link) or guess (Find board). */
		source: pg.text("source").notNull(),
		/** Roles open at this moment landed in New roles once; later runs bring only roles first seen after it. */
		confirmedAt: pg.timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [pg.uniqueIndex().on(t.userId, t.companyId, t.boardId), pg.index().on(t.boardId)],
);
