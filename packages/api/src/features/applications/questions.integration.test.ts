import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";
import { targetingQuestionSchema } from "@reactive-resume/schema/applications/data";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined }));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));
const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

const question = (id: string, text: string, topic: string | null) =>
	targetingQuestionSchema.parse({ id, question: text, topic, proposedFact: "", factGroup: "experience/intact" });

suite("Targeting questions shared by topic", () => {
	let admin: Pool;
	let pool: Pool;
	let applications: (typeof import("./service"))["applicationService"];
	const schemaName = `questions_test_${randomUUID().replaceAll("-", "")}`;
	const userId = "questions-owner";
	const otherId = "questions-other";

	beforeAll(async () => {
		if (!databaseUrl || new URL(databaseUrl).pathname !== "/rr_test")
			throw new Error("Question tests require the isolated rr_test database.");
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
		applications = (await import("./service")).applicationService;
	}, 60_000);

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	it("answering closes open questions with the same topic on the user's other applications only", async () => {
		const temporal = await applications.create({
			userId,
			company: "Temporal",
			role: "SRE",
			targetingQuestions: [question("t1", "Any T-Cloud result?", "intact/t-cloud"), question("t2", "Any Go?", "go")],
		});
		const kong = await applications.create({
			userId,
			company: "Kong",
			role: "SE",
			targetingQuestions: [question("k1", "For the 20+ T-Cloud teams, what improved?", "intact/t-cloud")],
		});
		const stranger = await applications.create({
			userId: otherId,
			company: "Elsewhere",
			role: "SRE",
			targetingQuestions: [question("s1", "T-Cloud?", "intact/t-cloud")],
		});

		await applications.updateQuestion({
			id: temporal,
			userId,
			questionId: "t1",
			status: "answered",
			answer: "Onboarded 20+ teams.",
			factId: "fact-1",
		});

		const kongAfter = await applications.getById({ id: kong, userId });
		expect(kongAfter.targetingQuestions[0]).toMatchObject({
			status: "answered",
			answer: "Onboarded 20+ teams.",
			factId: "fact-1",
			answeredOn: { applicationId: temporal, company: "Temporal" },
		});
		const temporalAfter = await applications.getById({ id: temporal, userId });
		expect(temporalAfter.targetingQuestions.map((q) => [q.id, q.status, q.answeredOn])).toEqual([
			["t1", "answered", null],
			["t2", "open", null],
		]);
		const strangerAfter = await applications.getById({ id: stranger, userId: otherId });
		expect(strangerAfter.targetingQuestions[0]?.status).toBe("open");

		// A later application asking the same topic arrives answered.
		const later = await applications.create({
			userId,
			company: "Okta",
			role: "FDE",
			targetingQuestions: [question("o1", "What did the T-Cloud work achieve?", "intact/t-cloud")],
		});
		expect((await applications.getById({ id: later, userId })).targetingQuestions[0]).toMatchObject({
			status: "answered",
			answeredOn: { company: "Temporal" },
		});

		// A rebuild writing the topic again on Kong keeps it answered.
		await applications.update({
			id: kong,
			userId,
			targetingQuestions: [question("k9", "T-Cloud outcome, reworded?", "intact/t-cloud")],
		});
		expect((await applications.getById({ id: kong, userId })).targetingQuestions.map((q) => q.status)).toEqual([
			"answered",
		]);
	});
});
