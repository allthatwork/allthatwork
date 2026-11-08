import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";
import { applicationViewFiltersSchema } from "@reactive-resume/schema/applications/views";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined }));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));
const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

const filters = applicationViewFiltersSchema.parse({ stage: ["saved"], build: ["built"] });
const layout = { sort: { sort: "fit" as const, dir: "desc" as const }, listColumns: ["fit" as const, "tfit" as const] };

suite("Saved views of the Applications screen", () => {
	let admin: Pool;
	let pool: Pool;
	let views: (typeof import("./views"))["applicationViewService"];
	const schemaName = `views_test_${randomUUID().replaceAll("-", "")}`;
	const userId = "views-owner";
	const otherId = "views-other";

	beforeAll(async () => {
		if (!databaseUrl || new URL(databaseUrl).pathname !== "/rr_test")
			throw new Error("View tests require the isolated rr_test database.");
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
		await fixture.db.insert(tables.user).values(
			[userId, otherId].map((id) => ({
				id,
				name: id,
				email: `${id}@example.test`,
				username: id,
				displayUsername: id,
			})),
		);
		views = (await import("./views")).applicationViewService;
	}, 60_000);

	beforeEach(async () => {
		await fixture.db?.delete(tables.applicationView);
	});

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	it("creates, lists in order, updates and deletes a user's views", async () => {
		const first = await views.create({ userId, name: "To build", filters, layout });
		const second = await views.create({ userId, name: "Ready to apply", filters, layout });
		expect([first.position, second.position]).toEqual([0, 1]);
		expect((await views.list(userId)).map((view) => view.name)).toEqual(["To build", "Ready to apply"]);

		const renamed = await views.update({
			userId,
			id: first.id,
			name: "Queued",
			layout: { ...layout, listColumns: [] },
		});
		expect(renamed).toMatchObject({ name: "Queued", layout: { sort: layout.sort, listColumns: [] } });
		expect(renamed.filters).toEqual(filters);

		const deleted = await views.delete({ userId, id: second.id });
		expect(deleted.name).toBe("Ready to apply");
		expect((await views.list(userId)).map((view) => view.name)).toEqual(["Queued"]);
		await expect(views.delete({ userId, id: second.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("keeps another account out", async () => {
		const mine = await views.create({ userId, name: "Mine", filters, layout });
		expect(await views.list(otherId)).toEqual([]);
		await expect(views.update({ userId: otherId, id: mine.id, name: "Theirs" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(views.delete({ userId: otherId, id: mine.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
		await views.reorder({ userId: otherId, ids: [mine.id] });
		expect((await views.list(userId))[0]).toMatchObject({ name: "Mine", position: 0 });
		// Another account can use the same name.
		await expect(views.create({ userId: otherId, name: "Mine", filters, layout })).resolves.toMatchObject({
			name: "Mine",
		});
	});

	it("keeps names unique per account, ignoring case", async () => {
		const ready = await views.create({ userId, name: "Ready to apply", filters, layout });
		const other = await views.create({ userId, name: "In flight", filters, layout });
		await expect(views.create({ userId, name: "READY TO APPLY", filters, layout })).rejects.toMatchObject({
			code: "CONFLICT",
			data: { reason: "name-taken" },
		});
		await expect(views.update({ userId, id: other.id, name: "ready to apply" })).rejects.toMatchObject({
			code: "CONFLICT",
		});
		// Renaming a view to its own name in another case is fine.
		await expect(views.update({ userId, id: ready.id, name: "Ready To Apply" })).resolves.toMatchObject({
			name: "Ready To Apply",
		});
	});

	it("allows 50 views per account", async () => {
		await fixture.db
			?.insert(tables.applicationView)
			.values(
				Array.from({ length: 50 }, (_, index) => ({ userId, name: `View ${index}`, filters, layout, position: index })),
			);
		await expect(views.create({ userId, name: "One more", filters, layout })).rejects.toMatchObject({
			code: "BAD_REQUEST",
			data: { reason: "limit" },
		});
		await expect(views.create({ userId: otherId, name: "One more", filters, layout })).resolves.toBeTruthy();
	});

	it("keeps one default at a time", async () => {
		const first = await views.create({ userId, name: "First", filters, layout, isDefault: true });
		const second = await views.create({ userId, name: "Second", filters, layout, isDefault: true });
		const defaults = () =>
			views.list(userId).then((list) => list.filter((view) => view.isDefault).map((view) => view.id));
		expect(await defaults()).toEqual([second.id]);
		await views.update({ userId, id: first.id, isDefault: true });
		expect(await defaults()).toEqual([first.id]);
		await views.update({ userId, id: first.id, isDefault: false });
		expect(await defaults()).toEqual([]);
	});

	it("reorders, keeping views left out after the listed ones", async () => {
		const a = await views.create({ userId, name: "A", filters, layout });
		const b = await views.create({ userId, name: "B", filters, layout });
		const c = await views.create({ userId, name: "C", filters, layout });
		const ordered = await views.reorder({ userId, ids: [c.id, "not-mine", a.id] });
		expect(ordered.map((view) => [view.name, view.position])).toEqual([
			["C", 0],
			["A", 1],
			["B", 2],
		]);
		expect(b.id).toBeTruthy();
		// A new view goes at the end.
		expect((await views.create({ userId, name: "D", filters, layout })).position).toBe(3);
	});

	it("reads stored values leniently", async () => {
		await fixture.db?.insert(tables.applicationView).values({
			userId,
			name: "Old",
			// Shapes a later change could leave behind.
			filters: { fit: { min: 80 }, build: ["built", "gone"] } as never,
			layout: { sort: "nope", listColumns: ["retired", "lane"] } as never,
		});
		const [old] = await views.list(userId);
		expect(old?.filters.fit).toBe("any");
		expect(old?.filters.build).toEqual(["built"]);
		expect(old?.layout).toEqual({ sort: { sort: "updated", dir: "desc" }, listColumns: ["lane"] });
	});

	it("goes with its account", async () => {
		await views.create({ userId: otherId, name: "Gone soon", filters, layout });
		await fixture.db?.delete(tables.user).where(eq(tables.user.id, otherId));
		expect(await views.list(otherId)).toEqual([]);
	});
});
