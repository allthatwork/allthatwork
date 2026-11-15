import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { truncateCascade } from "../../test-database";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined }));

vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));
vi.mock("./events", () => ({ publishResumeUpdated: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@reactive-resume/auth/config", () => ({
	auth: { $context: Promise.resolve({ secretConfig: { key: "synthetic-test-key" } }) },
	isCustomOAuthProviderEnabled: () => false,
}));
vi.mock("@reactive-resume/pdf/server", () => ({ createResumePdfFile: vi.fn() }));

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL ?? process.env.COVER_LETTER_TEST_DATABASE_URL;

// Real PostgreSQL, opt-in only, in a schema of its own built from the shipped migrations: savepoints, the unique
// slug and primary indexes, and concurrent transactions are what's under test.
describe.skipIf(!databaseUrl)("resume addresses and the primary resume", () => {
	let resumes: typeof import("./service").resumeService;
	let documents: typeof import("../documents/service").documentsService;
	let findResume: typeof import("./slugs").findResume;
	let checkSlug: typeof import("./slugs").checkSlug;
	let admin: Pool;
	let pool: Pool;
	const schemaName = `resume_address_${randomUUID().replaceAll("-", "")}`;
	const db = () => {
		if (!fixture.db) throw new Error("Test database is not initialized.");
		return fixture.db;
	};

	beforeAll(async () => {
		admin = new Pool({ connectionString: databaseUrl });
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		pool = new Pool({
			connectionString: databaseUrl,
			max: 6,
			application_name: schemaName,
			options: `-c search_path=${schemaName}`,
		});
		fixture.db = drizzle({ client: pool });
		const migrations = new URL("../../../../../migrations/", import.meta.url);
		const directories = (await readdir(migrations, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
			.map((entry) => entry.name)
			.sort();
		for (const directory of directories) {
			const file = new URL(`${directory}/migration.sql`, migrations);
			if (!existsSync(file)) continue;
			await pool.query((await readFile(file, "utf8")).replaceAll('"public".', ""));
		}
		resumes = (await import("./service")).resumeService;
		documents = (await import("../documents/service")).documentsService;
		findResume = (await import("./slugs")).findResume;
		checkSlug = (await import("./slugs")).checkSlug;
	}, 30_000);

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	beforeEach(async () => {
		await truncateCascade(pool, ["released_username", "storage_cleanup_job", "user"]);
		await db()
			.insert(tables.user)
			.values(
				["priya", "other"].map((id) => ({
					id,
					name: id,
					email: `${id}@example.test`,
					username: id,
					displayUsername: id,
				})),
			);
	});

	const create = (name: string, extra: { autoName?: boolean; slug?: string; userId?: string } = {}) =>
		resumes.create({ userId: "priya", name, tags: [], locale: "en-US", ...extra });
	const read = (id: string) => resumes.getById({ id, userId: "priya" });
	const withHeadline = async (id: string, headline: string) => {
		const current = await read(id);
		const data = structuredClone(current.data);
		data.basics.headline = headline;
		return resumes.update({ id, userId: "priya", data, expectedUpdatedAt: current.updatedAt });
	};
	const publish = (id: string, extra: { isPrimary?: boolean } = {}) =>
		resumes.update({ id, userId: "priya", isPublic: true, ...extra });
	// What a visitor's address opens: as the public web page looks it up, published resumes only.
	const opensAt = async (match: { slug: string } | { primary: true }) =>
		(await findResume({ username: "priya", ...match }, { id: tables.resume.id }, eq(tables.resume.isPublic, true)))?.id;

	const waitForLocks = async (count: number) => {
		for (let attempt = 0; attempt < 400; attempt++) {
			const { rows } = await admin.query<{ count: number }>(
				"SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
				[schemaName],
			);
			if ((rows[0]?.count ?? 0) >= count) return;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw new Error(`Expected ${count} address writes to wait on the held row.`);
	};
	const settle = <T>(write: Promise<T>) =>
		write.then(
			(value) => ({ ok: true as const, value }),
			(error: unknown) => ({ ok: false as const, error }),
		);

	// The fork keeps public addresses unguessable: a new resume gets a random address that never follows its name,
	// publishing keeps it, and nothing becomes primary by itself (upstream's name-based addresses and automatic primary
	// are not taken).
	describe("a new resume's address is random and stays put", () => {
		it("starts every new resume, copies and blank ones included, at a random address", async () => {
			const blank = await create("Untitled resume", { autoName: true });
			const copy = await resumes.create({
				userId: "priya",
				name: "Base (Copy)",
				tags: [],
				locale: "en-US",
				data: structuredClone(defaultResumeData),
			});
			for (const id of [blank, copy]) expect((await read(id)).slug).toMatch(/^[a-z0-9]{12}$/);
			expect((await read(blank)).slug).not.toBe((await read(copy)).slug);
		});

		it("keeps the address when the name follows the headline, when renamed, and when published", async () => {
			const id = await create("Untitled resume", { autoName: true });
			const { slug } = await read(id);
			await expect(withHeadline(id, "Computer science student")).resolves.toMatchObject({
				name: "Computer science student",
				slug,
			});
			await documents.rename({ type: "resume", id, userId: "priya", name: "Base" });
			expect((await read(id)).slug).toBe(slug);
			await expect(publish(id)).resolves.toMatchObject({ slug, isPublic: true });
			expect(await opensAt({ slug })).toBe(id);
		});

		it("keeps an address chosen by hand on publishing", async () => {
			const id = await create("Portfolio", { slug: "my-portfolio" });
			await expect(publish(id)).resolves.toMatchObject({ slug: "my-portfolio" });
			expect(await opensAt({ slug: "my-portfolio" })).toBe(id);
		});

		it("suggests another free address, never the requesting resume's own current one", async () => {
			const mine = await create("Mine", { slug: "foo-2" });
			await create("Holder", { slug: "foo" });
			await expect(checkSlug({ userId: "priya", resumeId: mine, slug: "foo" })).resolves.toEqual({
				status: "taken",
				takenBy: "Holder",
				suggestion: "foo-3",
			});
			// An invalid spelling that normalizes to the requesting resume's own address also moves past it.
			await expect(checkSlug({ userId: "priya", resumeId: mine, slug: "Foo 2" })).resolves.toMatchObject({
				status: "invalid",
				suggestion: "foo-2-2",
			});
		});
	});

	describe("the primary resume is the owner's choice", () => {
		it("doesn't make a published resume primary by itself", async () => {
			const id = await create("Only");
			await expect(publish(id)).resolves.toMatchObject({ isPublic: true, isPrimary: false });
			expect(await opensAt({ primary: true })).toBeUndefined();
			await expect(publish(id, { isPrimary: true })).resolves.toMatchObject({ isPrimary: true });
			expect(await opensAt({ primary: true })).toBe(id);
		});

		it("answers Make primary with a retryable conflict, not a 500, when another write takes the role at the same moment", async () => {
			const chosen = await create("Chosen");
			await publish(chosen, { isPrimary: false });
			const claimed = await create("Claimed");
			const holder = await admin.connect();
			let explicit: ReturnType<typeof settle<unknown>> | undefined;
			try {
				await holder.query("BEGIN");
				// Another write taking the role at the same moment, not yet committed.
				await holder.query(
					`UPDATE ${schemaName}.resume SET is_primary = true, is_public = true WHERE id = $1 AND user_id = 'priya' AND NOT EXISTS (SELECT 1 FROM ${schemaName}.resume o WHERE o.user_id = 'priya' AND o.is_primary)`,
					[claimed],
				);
				explicit = settle(resumes.update({ id: chosen, userId: "priya", isPrimary: true }));
				await waitForLocks(1);
				await holder.query("COMMIT");
			} finally {
				await holder.query("ROLLBACK").catch(() => {});
				holder.release();
			}

			if (!explicit) throw new Error("The explicit primary write did not start.");
			const result = await explicit;
			expect(result.ok).toBe(false);
			if (result.ok) throw new Error("Expected the explicit primary change to lose the unique-index race.");
			expect(result.error).toMatchObject({ code: "RESUME_PRIMARY_CONFLICT", status: 409 });
			// Nothing was written, so trying again takes the role from the resume that won.
			await expect(resumes.update({ id: chosen, userId: "priya", isPrimary: true })).resolves.toMatchObject({
				isPrimary: true,
			});
			const rows = await db()
				.select({ id: tables.resume.id })
				.from(tables.resume)
				.where(and(eq(tables.resume.userId, "priya"), eq(tables.resume.isPrimary, true)));
			expect(rows).toEqual([{ id: chosen }]);
		});
	});
});
