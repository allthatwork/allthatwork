import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined }));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));
const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite("A posting's deadline on an application", () => {
	let admin: Pool;
	let pool: Pool;
	let applications: (typeof import("./service"))["applicationService"];
	const schemaName = `deadline_test_${randomUUID().replaceAll("-", "")}`;
	const userId = "deadline-owner";
	const closesAt = new Date("2026-12-01T23:59:59.000Z");

	beforeAll(async () => {
		if (!databaseUrl || new URL(databaseUrl).pathname !== "/rr_test")
			throw new Error("Deadline tests require the isolated rr_test database.");
		admin = new Pool({ connectionString: databaseUrl });
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		pool = new Pool({ connectionString: databaseUrl, max: 1, options: `-c search_path=${schemaName}` });
		fixture.db = drizzle({ client: pool });
		const migrations = new URL("../../../../../migrations/", import.meta.url);
		const directories = (await readdir(migrations, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
			.map((entry) => entry.name)
			.sort();
		for (const directory of directories) {
			const sql = await readFile(new URL(`${directory}/migration.sql`, migrations), "utf8");
			await pool.query(sql.replaceAll('"public".', ""));
		}
		await fixture.db
			.insert(tables.user)
			.values({ id: userId, name: userId, email: `${userId}@example.test`, username: userId, displayUsername: userId });
		applications = (await import("./service")).applicationService;
	}, 60_000);

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	it("is stored on create, returned in the list, changed and cleared by update", async () => {
		const id = await applications.create({ userId, company: "Harbor", role: "SRE", closesAt });
		expect((await applications.getById({ id, userId })).closesAt).toEqual(closesAt);
		const list = await applications.listSummary({ userId, limit: 50 });
		expect(list.items.find((item) => item.id === id)?.closesAt).toEqual(closesAt);

		const later = new Date("2026-12-15T17:00:00.000Z");
		await applications.update({ id: id, userId, closesAt: later });
		expect((await applications.getById({ id: id, userId })).closesAt).toEqual(later);
		// An update that leaves it out keeps it.
		await applications.update({ id: id, userId, salary: "$200k" });
		expect((await applications.getById({ id: id, userId })).closesAt).toEqual(later);
		await applications.update({ id: id, userId, closesAt: null });
		expect((await applications.getById({ id: id, userId })).closesAt).toBeNull();
	});

	it("comes in with an import", async () => {
		await applications.importMany({ userId, items: [{ company: "Lumen", role: "Platform lead", closesAt }] });
		const list = await applications.listSummary({ userId, limit: 50 });
		expect(list.items.find((item) => item.company === "Lumen")?.closesAt).toEqual(closesAt);
	});
});
