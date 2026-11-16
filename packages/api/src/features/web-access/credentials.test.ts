import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fixtures = vi.hoisted(() => ({
	env: {} as {
		WEB_SEARCH_SEARXNG_URL?: string;
		WEB_SEARCH_BUILTIN?: boolean;
		WEB_ACCESS_PROVIDER?: "tavily";
		WEB_ACCESS_API_KEY?: string;
		ENCRYPTION_SECRET?: string;
	},
	saved: [] as { provider: string; encryptedApiKey: string; testResult: unknown }[],
}));
vi.mock("@reactive-resume/env/server", () => ({ env: fixtures.env }));
// Without ENCRYPTION_SECRET no saved credential is read; with it, the one saved row comes from `fixtures.saved`.
vi.mock("@reactive-resume/db/client", () => ({
	db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => fixtures.saved }) }) }) },
}));

const { webAccessService } = await import("./credentials");

describe("web access status", () => {
	beforeEach(() => {
		for (const key of Object.keys(fixtures.env)) delete fixtures.env[key as keyof typeof fixtures.env];
		fixtures.saved = [];
	});

	it("says search goes to the server's SearXNG when no connection is configured", async () => {
		fixtures.env.WEB_SEARCH_SEARXNG_URL = "http://searxng:8080";
		expect(await webAccessService.status("alice")).toMatchObject({
			configured: false,
			provider: null,
			search: true,
			searxng: true,
		});
	});

	it("says search goes to SearXNG beside a shared web connection", async () => {
		fixtures.env.WEB_SEARCH_SEARXNG_URL = "http://searxng:8080";
		fixtures.env.WEB_ACCESS_PROVIDER = "tavily";
		expect(await webAccessService.status("alice")).toMatchObject({
			managed: true,
			provider: "tavily",
			search: true,
			searxng: true,
		});
	});

	it("reports no SearXNG and no search without either", async () => {
		expect(await webAccessService.status("alice")).toMatchObject({ search: false, searxng: false });
	});

	it("says search goes to the built-in search with nothing set up", async () => {
		fixtures.env.WEB_SEARCH_BUILTIN = true;
		expect(await webAccessService.status("alice")).toMatchObject({ search: true, builtInSearch: true, provider: null });
		expect(await webAccessService.canSearch("alice", false)).toBe(true);
	});

	it("leaves search off when the server turns the built-in search off", async () => {
		fixtures.env.WEB_SEARCH_BUILTIN = false;
		expect(await webAccessService.status("alice")).toMatchObject({ search: false, builtInSearch: false });
		expect(await webAccessService.canSearch("alice", false)).toBe(false);
	});

	it("doesn't use the built-in search beside SearXNG or a server connection", async () => {
		fixtures.env.WEB_SEARCH_BUILTIN = true;
		fixtures.env.WEB_SEARCH_SEARXNG_URL = "http://searxng:8080";
		expect(await webAccessService.status("alice")).toMatchObject({ search: true, builtInSearch: false });
		delete fixtures.env.WEB_SEARCH_SEARXNG_URL;
		fixtures.env.WEB_ACCESS_PROVIDER = "tavily";
		fixtures.env.WEB_ACCESS_API_KEY = "test-key";
		expect(await webAccessService.status("alice")).toMatchObject({ search: true, builtInSearch: false });
		expect(await webAccessService.usesBuiltInSearch("alice")).toBe(false);
	});

	it("keeps search off for a saved connection whose last test failed, without the built-in search", async () => {
		fixtures.env.WEB_SEARCH_BUILTIN = true;
		fixtures.env.ENCRYPTION_SECRET = "test-encryption-secret";
		const failed = { success: false, error: "auth" };
		fixtures.saved = [{ provider: "tavily", encryptedApiKey: "sealed", testResult: { search: failed, read: failed } }];
		expect(await webAccessService.status("alice")).toMatchObject({
			provider: "tavily",
			search: false,
			builtInSearch: false,
		});
		expect(await webAccessService.usesBuiltInSearch("alice")).toBe(false);
		expect(await webAccessService.canSearch("alice", false)).toBe(false);
	});

	it("changes the revision when the built-in search setting changes", async () => {
		fixtures.env.WEB_SEARCH_BUILTIN = true;
		const on = (await webAccessService.status("alice")).revision;
		fixtures.env.WEB_SEARCH_BUILTIN = false;
		expect((await webAccessService.status("alice")).revision).not.toBe(on);
	});
});
