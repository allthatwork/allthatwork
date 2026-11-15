import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

// The real lookup query, run against a stand-in `pg` client that records the SQL and returns `rows`.
const pg = vi.hoisted(() => ({ queries: [] as { text: string; params: unknown[] }[], rows: [] as unknown[][] }));
vi.mock("@reactive-resume/db/client", async () => {
	const { drizzle } = await import("drizzle-orm/node-postgres");
	const client = {
		query: ({ text }: { text: string }, params: unknown[]) => {
			pg.queries.push({ text, params });
			return Promise.resolve({ rows: pg.rows });
		},
	};
	return { db: drizzle({ client: client as never }) };
});

const { loadPublicWebPage } = await import("./web-page");

// Columns in select order: id, userId, username, slug, data, updatedAt, isPrimary, passwordHash, showDownloadButtons,
// showInSearchEngines, hideContactDetails, customDomain.
const row = (username: string, slug: string) => [
	"r1",
	"u1",
	username,
	slug,
	defaultResumeData,
	new Date(),
	false,
	null,
	true,
	false,
	false,
	null,
];

describe("loadPublicWebPage", () => {
	beforeEach(() => {
		pg.queries = [];
		pg.rows = [];
	});

	it("moves a link with an old username to the current address", async () => {
		pg.rows = [row("jane-new", "k3v9x2m7qa4p")];

		const page = await loadPublicWebPage({
			match: { username: "Jane", slug: "k3v9x2m7qa4p" },
			requestHeaders: new Headers(),
			trustedClient: "test",
		});

		expect(page).toEqual({
			status: "moved",
			username: "jane-new",
			slug: "k3v9x2m7qa4p",
			isPrimary: false,
			movedBy: "username",
		});
		const [query] = pg.queries;
		expect(query?.text).toContain('"released_username"."username" = $4');
		expect(query?.params[3]).toBe("jane");
	});

	it("moves a link with an old slug to the current address", async () => {
		pg.rows = [row("jane", "k3v9x2m7qa4p")];

		const page = await loadPublicWebPage({
			match: { username: "jane", slug: "old-slug" },
			requestHeaders: new Headers(),
			trustedClient: "test",
		});

		expect(page).toEqual({
			status: "moved",
			username: "jane",
			slug: "k3v9x2m7qa4p",
			isPrimary: false,
			movedBy: "slug",
		});
	});
});
