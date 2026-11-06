import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";
import { careerProfileDataSchema, careerScheduleInputSchema } from "@reactive-resume/schema/career";
import { boardsDto } from "../../dto/boards";

const fixture = vi.hoisted(() => ({
	db: undefined as ReturnType<typeof drizzle> | undefined,
}));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));
vi.mock("@reactive-resume/env/server", async () => {
	const actual = await vi.importActual<typeof import("@reactive-resume/env/server")>("@reactive-resume/env/server");
	return {
		...actual,
		env: {
			...actual.env,
			APP_URL: "http://localhost:3000",
			CLOUDFLARE: false,
			CRON_SECRET: undefined,
			SMTP_HOST: undefined,
			SMTP_USER: undefined,
			SMTP_PASS: undefined,
			SMTP_FROM: undefined,
		},
	};
});
// No live network or AI: the board APIs answer from recorded fixtures through a stubbed fetch.
vi.mock("../applications/posting", () => ({ searchJobPostings: vi.fn(), readOpenPosting: vi.fn() }));
vi.mock("../web-access/credentials", () => ({ webAccessService: { resolve: async () => null } }));
vi.mock("@reactive-resume/email/transport", () => ({ sendCareerNotification: vi.fn() }));
vi.mock("../career/generate", () => ({ generateCareer: vi.fn() }));
vi.mock("../ai-providers/service", () => ({ aiProvidersService: { getRunnableById: async () => ({}) } }));
// Careers pages are read without fetch; each test says what they answer.
const page = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../web-access/builtin", async () => ({
	...(await vi.importActual<typeof import("../web-access/builtin")>("../web-access/builtin")),
	readBuiltinPage: page.read,
}));

const recorded = (name: string) =>
	JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as Record<string, unknown>;
const ashby = recorded("ashby-board") as { apiVersion: string; jobs: Record<string, unknown>[] };
const greenhouseJobs = recorded("greenhouse-jobs") as { jobs: Record<string, unknown>[] };

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL ?? process.env.COVER_LETTER_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("job board checks", () => {
	let boards: typeof import("./service").boardsService;
	let jobs: typeof import("../career/jobs").careerJobs;
	let run: typeof import("../career/jobs").runCareerJobs;
	let track: typeof import("../career/service").careerService.trackOpportunity;
	let admin: Pool;
	let pool: Pool;
	const schemaName = `job_boards_test_${randomUUID().replaceAll("-", "")}`;
	const getDb = () => {
		if (!fixture.db) throw new Error("Test database is not initialized.");
		return fixture.db;
	};

	/** What each board API answers now; a missing entry is a 503. */
	let answers: Record<string, unknown>;
	const calls: string[] = [];

	beforeAll(async () => {
		admin = new Pool({ connectionString: databaseUrl });
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		pool = new Pool({
			connectionString: databaseUrl,
			options: `-c search_path=${schemaName} -c statement_timeout=10000`,
		});
		fixture.db = drizzle({ client: pool });
		const migrations = new URL("../../../../../migrations/", import.meta.url);
		const directories = (await readdir(migrations, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
			.map((entry) => entry.name)
			.sort();
		for (const directory of directories) {
			const file = new URL(`${directory}/migration.sql`, migrations);
			if (existsSync(file)) await pool.query((await readFile(file, "utf8")).replaceAll('"public".', ""));
		}
		({ boardsService: boards } = await import("./service"));
		({ careerJobs: jobs, runCareerJobs: run } = await import("../career/jobs"));
		track = (await import("../career/service")).careerService.trackOpportunity;
	}, 30_000);

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	beforeEach(async () => {
		vi.stubEnv("VERCEL", "");
		calls.length = 0;
		page.read.mockReset();
		page.read.mockRejectedValue(new Error("unreachable"));
		answers = {
			"https://api.ashbyhq.com/posting-api/job-board/linear?includeCompensation=true": ashby,
			"https://boards-api.greenhouse.io/v1/boards/gitlab/jobs": greenhouseJobs,
			"https://boards-api.greenhouse.io/v1/boards/gitlab": recorded("greenhouse-board"),
			"https://boards-api.greenhouse.io/v1/boards/gitlab/jobs/8771512002?pay_transparency=true": {
				...recorded("greenhouse-job"),
				id: 8771512002,
				title: "Backend Engineer, GitLab Orbit",
			},
			"https://boards-api.greenhouse.io/v1/boards/gitlab/jobs/8704363002?pay_transparency=true": {
				...recorded("greenhouse-job"),
				id: 8704363002,
				title: "Backend Engineer (Python),AI Engineering: Agent Foundations",
				pay_input_ranges: [],
			},
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				calls.push(url);
				const body = answers[url];
				return body === undefined
					? new Response("down", { status: 503 })
					: new Response(JSON.stringify(body), { status: 200 });
			}),
		);
		await pool.query('TRUNCATE "user", job_board CASCADE');
		for (const id of ["alice", "bob"]) {
			await getDb()
				.insert(tables.user)
				.values({ id, name: id, email: `${id}@example.test`, username: id, displayUsername: id, emailVerified: true });
			await getDb()
				.insert(tables.careerProfile)
				.values({
					userId: id,
					data: careerProfileDataSchema.parse({
						targetRoles: ["Engineer"],
						locations: ["Remote"],
						excludeTitles: id === "bob" ? ["Product"] : [],
					}),
				});
		}
		await getDb()
			.insert(tables.company)
			.values([
				{ id: "alice-linear", userId: "alice", name: "Linear", normalizedKey: "linear" },
				{ id: "alice-gitlab", userId: "alice", name: "GitLab", normalizedKey: "gitlab" },
				{ id: "bob-linear", userId: "bob", name: "Linear", normalizedKey: "linear" },
			]);
		await getDb()
			.insert(tables.contact)
			.values([
				{
					userId: "alice",
					companyId: "alice-linear",
					name: "Dana Example",
					normalizedKey: "dana example",
					position: "EM",
				},
				{ userId: "bob", companyId: "bob-linear", name: "Lee Example", normalizedKey: "lee example" },
			]);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	const watchLinear = (userId: "alice" | "bob") =>
		boards.watch(userId, {
			companyId: `${userId}-linear`,
			ats: "ashby",
			region: "us",
			slug: "linear",
			source: "guess",
		});
	/** Lets the next run fetch again, as if the hour had passed. */
	const expire = () => pool.query("update job_board set checked_at = now() - interval '2 hours'");
	const schedule = () =>
		jobs.save(
			"alice",
			careerScheduleInputSchema.parse({
				kind: "boards",
				enabled: true,
				timezone: "Europe/Berlin",
				// Tomorrow: the runs here are Run now.
				nextRunAt: new Date(Date.now() + 86_400_000),
				intervalDays: 1,
			}),
		);
	const runNow = async (id: string) => {
		await jobs.runNow("alice", id);
		await run();
	};

	it("brings a confirmed board's open matching roles in once, with the company's contacts", async () => {
		await expect(watchLinear("alice")).resolves.toMatchObject({ added: 3 });
		const roles = await jobs.opportunities("alice");
		expect(roles).toHaveLength(3);
		expect(roles[0]).toMatchObject({
			source: "board",
			company: "Linear",
			companyId: "alice-linear",
			remote: true,
			contacts: [{ name: "Dana Example", position: "EM" }],
		});
		// Confirming again adds nothing, and a second watch of the same board is the same watch.
		await expect(watchLinear("alice")).resolves.toMatchObject({ added: 0 });
		expect(await getDb().select().from(tables.companyBoard)).toHaveLength(1);
	});

	it("fetches a shared board once for two accounts within the hour, and keeps each account's finds private", async () => {
		await watchLinear("alice");
		await watchLinear("bob");
		expect(calls.filter((url) => url.includes("ashbyhq"))).toHaveLength(1);
		expect(await getDb().select().from(tables.jobBoard)).toHaveLength(1);
		// Bob leaves out "Product" titles: his inbox has the two engineering roles, Alice's all three.
		expect((await jobs.opportunities("bob")).map((role) => role.role).sort()).toEqual([
			"Senior / Staff Fullstack Engineer",
			"Senior / Staff Fullstack Engineer",
		]);
		expect(await jobs.opportunities("alice")).toHaveLength(3);
		const bobs = await boards.company("bob", "bob-linear");
		expect(bobs.watched).toHaveLength(1);
		await expect(boards.company("bob", "alice-linear")).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(boards.unwatch("alice", bobs.watched[0]?.id ?? "")).rejects.toMatchObject({ code: "NOT_FOUND" });
		const [aliceRole] = await jobs.opportunities("alice");
		await jobs.dismissOpportunity("bob", aliceRole?.id ?? "");
		expect(await jobs.opportunities("alice")).toHaveLength(3);
		expect((await boards.exportData("bob")).map((row) => row.companyId)).toEqual(["bob-linear"]);
	});

	it("adds only roles first seen after confirming, closes roles that disappear, and a second run adds nothing", async () => {
		await watchLinear("alice");
		await watchLinear("bob");
		const saved = await schedule();
		const [gone, ...kept] = ashby.jobs;
		const fresh = {
			...kept[0],
			id: "fresh-0000",
			title: "Staff Engineer",
			jobUrl: "https://jobs.ashbyhq.com/linear/fresh-0000",
		};
		answers["https://api.ashbyhq.com/posting-api/job-board/linear?includeCompensation=true"] = {
			...ashby,
			jobs: [...kept, fresh],
		};
		await expire();
		await runNow(saved.id);
		const roles = await jobs.opportunities("alice");
		expect(roles.map((role) => role.role)).toContain("Staff Engineer");
		expect(roles.map((role) => role.url)).not.toContain(gone?.jobUrl);
		expect(roles).toHaveLength(3);
		// The closed role is closed for Bob too; his run hasn't happened, but the shared posting closed.
		expect((await jobs.opportunities("bob")).map((role) => role.url)).not.toContain(gone?.jobUrl);
		const notices = await jobs.notifications("alice");
		expect(notices).toMatchObject([
			{ notice: { type: "opportunities", count: 1, source: "boards" }, title: "1 new role to review" },
		]);
		await expire();
		await runNow(saved.id);
		expect(await jobs.opportunities("alice")).toHaveLength(3);
		expect(await jobs.notifications("alice")).toHaveLength(1);
	});

	it("keeps a failing board's postings and names it in the run's notice", async () => {
		await watchLinear("alice");
		const saved = await schedule();
		delete answers["https://api.ashbyhq.com/posting-api/job-board/linear?includeCompensation=true"];
		await expire();
		await runNow(saved.id);
		const [board] = await getDb().select().from(tables.jobBoard);
		expect(board).toMatchObject({ error: "unreachable", jobCount: 3 });
		expect(
			await getDb().select().from(tables.jobBoardPosting).where(isNull(tables.jobBoardPosting.closedAt)),
		).toHaveLength(3);
		expect(await jobs.opportunities("alice")).toHaveLength(3);
		expect(await jobs.notifications("alice")).toMatchObject([
			{ notice: { type: "boards-failed", failed: ["Linear"] }, url: "/dashboard/directory" },
		]);
	});

	it("reads Greenhouse job pages once, for roles that pass, and tracks one as a full application", async () => {
		await boards.watch("alice", {
			companyId: "alice-gitlab",
			ats: "greenhouse",
			region: "us",
			slug: "gitlab",
			source: "posting",
		});
		const details = () => calls.filter((url) => url.includes("/jobs/"));
		// Two engineering roles pass the title screen; the third ("AI Transformation Owner") is never read.
		expect(details()).toHaveLength(2);
		const roles = await jobs.opportunities("alice");
		expect(roles).toHaveLength(2);
		const orbit = roles.find((role) => role.role === "Backend Engineer, GitLab Orbit");
		expect(orbit?.pay).toEqual([{ min: 139_200, max: 235_200, currency: "USD", period: "year" }]);
		await expire();
		const saved = await schedule();
		await runNow(saved.id);
		expect(details()).toHaveLength(2);
		const { applicationId } = await track("alice", orbit?.id ?? "");
		const [application] = await getDb()
			.select()
			.from(tables.application)
			.where(and(eq(tables.application.id, applicationId), eq(tables.application.userId, "alice")));
		expect(application).toMatchObject({
			company: "GitLab",
			companyId: "alice-gitlab",
			salary: "USD 139,200–235,200 a year",
			source: "Greenhouse",
			sourceUrl: "https://job-boards.greenhouse.io/gitlab/jobs/8771512002",
		});
		expect(application?.jobDescription).toMatch(/^GitLab is the intelligent orchestration platform/);
	});

	it("allows one board checks schedule per account", async () => {
		const saved = await schedule();
		await expect(schedule()).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			jobs.save("alice", { ...careerScheduleInputSchema.parse({ ...saved, enabled: false }), id: saved.id }),
		).resolves.toMatchObject({ enabled: false, query: "" });
	});

	it("suggests companies with contacts, counting matching roles where a posting link names the board", async () => {
		await getDb().insert(tables.application).values({
			userId: "alice",
			company: "Linear",
			companyId: "alice-linear",
			role: "Engineer",
			sourceUrl: "https://jobs.ashbyhq.com/linear/12f8f208-0b9c-4569-bb3d-41c8a197029e",
		});
		const [suggestion] = await boards.suggestions("alice");
		expect(suggestion).toMatchObject({
			id: "alice-linear",
			contacts: 1,
			board: { ats: "ashby", slug: "linear" },
			openRoles: 3,
		});
		// Nothing was watched by suggesting it.
		expect(await getDb().select().from(tables.companyBoard)).toEqual([]);
		expect((await boards.company("alice", "alice-linear")).detected).toMatchObject([{ slug: "linear" }]);
		await watchLinear("alice");
		expect(await boards.suggestions("alice")).toEqual([]);
	});

	const careersUrl = async (companyId: string) =>
		(await getDb().select().from(tables.company).where(eq(tables.company.id, companyId)))[0]?.careersUrl;
	const WORKDAY = "https://lumen.wd5.myworkdayjobs.com/en-US/careers";

	it("saves a link that leads to no Greenhouse, Ashby or Lever page as the company's jobs link", async () => {
		page.read.mockResolvedValue({ html: "<html><body>Search jobs</body></html>", resolvedUrl: WORKDAY });
		await expect(boards.fromLink("alice", "alice-linear", WORKDAY)).resolves.toEqual({
			boards: [],
			savedLink: WORKDAY,
		});
		expect(await careersUrl("alice-linear")).toBe(WORKDAY);
		// A page that can't be opened at all (Workday often blocks or times out) is saved too, replacing the last one.
		page.read.mockRejectedValue(new Error("timeout"));
		const blocked = "https://careers.example.com/jobs";
		await expect(boards.fromLink("alice", "alice-linear", blocked)).resolves.toEqual({
			boards: [],
			savedLink: blocked,
		});
		expect(await careersUrl("alice-linear")).toBe(blocked);
		// Another account's company is out of reach.
		await expect(boards.fromLink("bob", "alice-linear", WORKDAY)).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects input that isn't a link", () => {
		expect(boardsDto.fromLink.input.safeParse({ companyId: "alice-linear", link: "Lumen Freight" }).success).toBe(
			false,
		);
		expect(boardsDto.fromLink.input.safeParse({ companyId: "alice-linear", link: "ftp://lumen.example" }).success).toBe(
			false,
		);
	});

	it("reads a Greenhouse link as before, saving nothing", async () => {
		const result = await boards.fromLink("alice", "alice-gitlab", "https://job-boards.greenhouse.io/gitlab");
		expect(result).toMatchObject({ boards: [{ ats: "greenhouse", slug: "gitlab", name: "GitLab" }], savedLink: null });
		expect(page.read).not.toHaveBeenCalled();
		expect(await careersUrl("alice-gitlab")).toBeNull();
		// A careers page that embeds one leads to it.
		page.read.mockResolvedValue({
			html: '<iframe src="https://boards.greenhouse.io/embed/job_board?for=gitlab"></iframe>',
			resolvedUrl: "https://about.gitlab.example/jobs",
		});
		await expect(boards.fromLink("alice", "alice-gitlab", "https://about.gitlab.example/jobs")).resolves.toMatchObject({
			boards: [{ slug: "gitlab" }],
			savedLink: null,
		});
		// One that points at a board that can't be read is an error, and nothing is saved.
		await expect(
			boards.fromLink("alice", "alice-gitlab", "https://job-boards.greenhouse.io/nobody-here"),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(await careersUrl("alice-gitlab")).toBeNull();
	});

	it("clears the saved link when a page is watched for the company", async () => {
		await getDb().update(tables.company).set({ careersUrl: WORKDAY }).where(eq(tables.company.id, "alice-linear"));
		await getDb().update(tables.company).set({ careersUrl: WORKDAY }).where(eq(tables.company.id, "bob-linear"));
		await watchLinear("alice");
		expect(await careersUrl("alice-linear")).toBeNull();
		expect(await careersUrl("bob-linear")).toBe(WORKDAY);
	});

	it("lists every company's watched page, found page with its stored count, and saved link in one go", async () => {
		const { directoryService } = await import("../directory/service");
		await boards.watch("alice", {
			companyId: "alice-gitlab",
			ats: "greenhouse",
			region: "us",
			slug: "gitlab",
			source: "link",
		});
		await getDb().insert(tables.application).values({
			userId: "alice",
			company: "Linear",
			companyId: "alice-linear",
			role: "Engineer",
			sourceUrl: "https://jobs.ashbyhq.com/linear/12f8f208-0b9c-4569-bb3d-41c8a197029e",
		});
		await getDb()
			.insert(tables.company)
			.values({ id: "alice-lumen", userId: "alice", name: "Lumen", normalizedKey: "lumen", careersUrl: WORKDAY });
		// Linear's page was never read: no count yet, and listing doesn't read it.
		const before = calls.length;
		const unread = await directoryService.companies({ userId: "alice" });
		expect(calls.length).toBe(before);
		expect(unread.find((row) => row.id === "alice-linear")?.jobs.found).toEqual({
			ats: "ashby",
			region: "us",
			slug: "linear",
			url: "https://jobs.ashbyhq.com/linear",
			jobCount: null,
		});
		// Bob watching it stores the shared board, so Alice's list shows its count.
		await watchLinear("bob");
		const rows = await directoryService.companies({ userId: "alice" });
		const byId = new Map(rows.map((row) => [row.id, row]));
		expect(byId.get("alice-linear")).toMatchObject({
			careersUrl: null,
			jobs: { watching: [], found: { jobCount: 3 } },
		});
		expect(byId.get("alice-gitlab")?.jobs).toMatchObject({
			watching: [
				{
					ats: "greenhouse",
					slug: "gitlab",
					source: "link",
					url: "https://job-boards.greenhouse.io/gitlab",
					jobCount: 3,
				},
			],
			found: null,
		});
		expect(byId.get("alice-gitlab")?.jobs.watching[0]?.id).toEqual(expect.any(String));
		expect(byId.get("alice-lumen")).toMatchObject({ careersUrl: WORKDAY, jobs: { watching: [], found: null } });
	});
});
