import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fixtures = vi.hoisted(() => ({
	fetchBuiltinPage:
		vi.fn<(url: string, signal: AbortSignal) => Promise<{ html: string; resolvedUrl: string; status: number }>>(),
}));
vi.mock("./builtin", async (original) => ({
	...(await original<typeof import("./builtin")>()),
	fetchBuiltinPage: fixtures.fetchBuiltinPage,
}));

const { duckDuckGoRegion, isBotCheck, parseDuckDuckGoResults, resultUrl, searchBuiltin } =
	await import("./builtin-search");

// One real DuckDuckGo HTML results page for "software engineer job posting" (2026-11-15; a geolocated city replaced).
const resultsPage = readFileSync(new URL("./fixtures/duckduckgo-results.html", import.meta.url), "utf8");
// DuckDuckGo's bot check, modelled on its `anomaly` challenge page.
const botCheckPage = readFileSync(new URL("./fixtures/duckduckgo-bot-check.html", import.meta.url), "utf8");
const emptyPage = `<html><body><div id="links" class="results"><div class="no-results">No results.</div></div></body></html>`;

const signal = () => new AbortController().signal;
const serve = (html: string, status = 200) =>
	fixtures.fetchBuiltinPage.mockResolvedValue({ html, resolvedUrl: "https://html.duckduckgo.com/html/", status });

beforeEach(() => {
	fixtures.fetchBuiltinPage.mockReset();
});

describe("DuckDuckGo results page", () => {
	it("reads each organic result's title, real link and snippet, in page order, without the ads", () => {
		const results = parseDuckDuckGoResults(resultsPage);
		expect(results).toHaveLength(10);
		expect(results[0]).toEqual({
			url: "https://www.indeed.com/q-Software-Engineer-jobs.html",
			title: "Now Hiring: 84,000 Software Engineer Jobs | Indeed",
			snippet:
				"Browse 84,068 Software Engineer jobs. New jobs posted today. Apply now and find your next opportunity on Indeed.com.",
		});
		expect(results.map((result) => new URL(result.url).hostname)).not.toContain("duckduckgo.com");
		expect(results.some((result) => /joblist\.com|y\.js/.test(result.url))).toBe(false);
		expect(results.map((result) => result.title)).not.toContain("1000s of Software/IT Jobs - Software Engineer Jobs");
	});

	it("decodes DuckDuckGo's wrapped links and drops its own pages", () => {
		expect(resultUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Fjobs.example.com%2Frole%3Fid%3D7&rut=abc")).toBe(
			"https://jobs.example.com/role?id=7",
		);
		expect(resultUrl("https://jobs.example.com/direct")).toBe("https://jobs.example.com/direct");
		expect(resultUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Fduckduckgo.com%2Fy.js%3Fad_domain%3Dexample.com")).toBe(
			null,
		);
		expect(resultUrl("//duckduckgo.com/about")).toBe(null);
	});

	it("tells the bot check from a results page", () => {
		expect(isBotCheck(botCheckPage)).toBe(true);
		expect(isBotCheck(resultsPage)).toBe(false);
		expect(isBotCheck(emptyPage)).toBe(false);
	});
});

describe("built-in search", () => {
	it("asks DuckDuckGo's HTML page and returns public results within the account's result limit", async () => {
		serve(resultsPage);
		const results = await searchBuiltin("software engineer job posting", { signal: signal(), maxResults: 3 });
		expect(results.map((result) => result.url)).toEqual([
			"https://www.indeed.com/q-Software-Engineer-jobs.html",
			"https://www.indeed.com/q-software-engineer-job-postings-jobs.html",
			"https://www.linkedin.com/jobs/software-engineer-jobs",
		]);
		const url = new URL(fixtures.fetchBuiltinPage.mock.calls[0]?.[0] ?? "");
		expect(url.origin + url.pathname).toBe("https://html.duckduckgo.com/html/");
		expect(url.searchParams.get("q")).toBe("software engineer job posting");
		expect(url.searchParams.has("kl")).toBe(false);
	});

	it("sends a region as DuckDuckGo's kl, country then its likely language", async () => {
		serve(resultsPage);
		await searchBuiltin("designer", { region: "de", signal: signal(), maxResults: 5 });
		expect(new URL(fixtures.fetchBuiltinPage.mock.calls[0]?.[0] ?? "").searchParams.get("kl")).toBe("de-de");
		expect(duckDuckGoRegion("US")).toBe("us-en");
		expect(duckDuckGoRegion("FR")).toBe("fr-fr");
		expect(duckDuckGoRegion("GB")).toBe("uk-en");
		expect(duckDuckGoRegion("JP")).toBe("jp-jp");
	});

	it("reports a 202 answer as a rate limit", async () => {
		serve(resultsPage, 202);
		await expect(searchBuiltin("designer", { signal: signal(), maxResults: 5 })).rejects.toMatchObject({
			reason: "rate-limit",
		});
	});

	it("reports the bot check page as a rate limit", async () => {
		serve(botCheckPage);
		await expect(searchBuiltin("designer", { signal: signal(), maxResults: 5 })).rejects.toMatchObject({
			reason: "rate-limit",
		});
	});

	it("returns an empty result for a page with no results and no bot check", async () => {
		serve(emptyPage);
		await expect(searchBuiltin("zzqx nothing matches", { signal: signal(), maxResults: 5 })).resolves.toEqual([]);
	});
});
