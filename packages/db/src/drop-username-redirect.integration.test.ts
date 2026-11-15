import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { Pool } from "pg";

// The fork's username_redirect moves into upstream's released_username (migration drop_username_redirect, v6.1.1 sync).
const MOVE = "20261115040430_drop_username_redirect";

describe.skipIf(!process.env.COVER_LETTER_TEST_DATABASE_URL)("moving the fork's old usernames", () => {
	const namespace = `redirect_test_${randomUUID().replaceAll("-", "")}`;
	const migrations = new URL("../../../migrations/", import.meta.url);
	let admin: Pool;
	let pool: Pool;
	let names: string[];
	const run = async (name: string) =>
		pool.query((await readFile(new URL(`${name}/migration.sql`, migrations), "utf8")).replaceAll('"public".', ""));

	beforeAll(async () => {
		admin = new Pool({ connectionString: process.env.COVER_LETTER_TEST_DATABASE_URL });
		await admin.query(`CREATE SCHEMA ${namespace}`);
		pool = new Pool({
			connectionString: process.env.COVER_LETTER_TEST_DATABASE_URL,
			options: `-c search_path=${namespace}`,
			max: 1,
		});
		names = (await readdir(migrations)).filter((name) => /^\d+_/.test(name)).sort();
		// Everything before the move, so the fork's table still exists.
		for (const name of names.slice(0, names.indexOf(MOVE))) await run(name);
	}, 60_000);

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
		await admin?.end();
	});

	it("keeps live redirects as released names, skips expired and taken ones, and drops the table", async () => {
		await pool.query(
			`INSERT INTO "user" (id,name,email,username,display_username) VALUES
			('alice','alice','alice@example.test','alexandru','alexandru'),
			('bob','bob','bob@example.test','bob','bob')`,
		);
		const day = 86_400_000;
		const at = (offset: number) => new Date(Date.now() + offset);
		// alexandru's older name, still live (changed 10 days ago); an expired one; one bob holds now; one the trigger
		// already recorded earlier, which the redirect's newer change time replaces.
		await pool.query(
			`INSERT INTO "username_redirect" (username,user_id,expires_at) VALUES
			('alice','alice',$1),('ally','alice',$2),('bob','alice',$1),('al','alice',$1)`,
			[at(20 * day), at(-day)],
		);
		await pool.query(`INSERT INTO "released_username" (username,user_id,released_at) VALUES ('al','alice',$1)`, [
			at(-25 * day),
		]);

		await run(MOVE);

		const { rows } = await pool.query(
			`SELECT username, user_id, released_at FROM "released_username" ORDER BY username`,
		);
		expect(rows.map((row) => [row.username, row.user_id])).toEqual([
			["al", "alice"],
			["alice", "alice"],
		]);
		for (const row of rows) expect(Math.round((Date.now() - row.released_at.getTime()) / day)).toBe(10);
		await expect(pool.query(`SELECT 1 FROM "username_redirect"`)).rejects.toMatchObject({ code: "42P01" });

		// The moved name is reserved: another account can't claim it.
		await expect(pool.query(`UPDATE "user" SET username='alice' WHERE id='bob'`)).rejects.toMatchObject({
			code: "23505",
		});

		// The rest of the chain still applies on top.
		for (const name of names.slice(names.indexOf(MOVE) + 1)) await run(name);
	});
});
