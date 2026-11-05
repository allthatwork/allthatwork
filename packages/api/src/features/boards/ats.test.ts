import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	BoardError,
	fetchBoard,
	fetchGreenhouseDetail,
	parseAshby,
	parseGreenhouse,
	parseGreenhouseJob,
	parseLever,
	websiteFromPostings,
} from "./ats";

/** Recorded from the public boards of GitLab (Greenhouse), Linear (Ashby) and Zoox (Lever), trimmed. */
const fixture = (name: string) =>
	JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as unknown;

afterEach(() => vi.unstubAllGlobals());

describe("Greenhouse", () => {
	it("reads a board's list without pay or text, which the job page holds", () => {
		const postings = parseGreenhouse(fixture("greenhouse-jobs"));
		expect(postings).toHaveLength(3);
		expect(postings[0]).toEqual({
			externalId: "8771512002",
			title: "Backend Engineer, GitLab Orbit",
			location: "Remote, Canada; Remote, United States",
			remote: true,
			workplace: "remote",
			url: "https://job-boards.greenhouse.io/gitlab/jobs/8771512002",
			pay: [],
			description: "",
			postedAt: new Date("2026-10-23T18:47:07-04:00"),
		});
	});

	it("reads a job page's escaped text and its pay in cents as yearly", () => {
		const job = parseGreenhouseJob(fixture("greenhouse-job"));
		expect(job?.pay).toEqual([{ min: 139_200, max: 235_200, currency: "USD", period: "year" }]);
		expect(job?.description).toMatch(/^GitLab is the intelligent orchestration platform/);
		expect(job?.description).not.toMatch(/<|&lt;/);
	});

	it("takes a small top of range as hourly pay", () => {
		const job = parseGreenhouseJob({
			id: 1,
			title: "Support",
			absolute_url: "https://acme.example/jobs?gh_jid=1",
			pay_input_ranges: [{ min_cents: 3000, max_cents: 4500, currency_type: "usd" }],
		});
		expect(job?.pay).toEqual([{ min: 30, max: 45, currency: "USD", period: "hour" }]);
	});
});

describe("Ashby", () => {
	it("reads postings with their salary, remote flag and text", () => {
		const postings = parseAshby(fixture("ashby-board"));
		expect(postings).toHaveLength(3);
		expect(postings[0]).toMatchObject({
			externalId: "12f8f208-0b9c-4569-bb3d-41c8a197029e",
			title: "Senior / Staff Product Engineer",
			location: "North America",
			remote: true,
			workplace: "remote",
			url: "https://jobs.ashbyhq.com/linear/12f8f208-0b9c-4569-bb3d-41c8a197029e",
			pay: [{ min: 204_000, max: 264_000, currency: "USD", period: "year" }],
			postedAt: new Date("2026-03-04T02:08:44.483+00:00"),
		});
		expect(postings[0]?.description.length).toBeGreaterThan(50);
		// Equity is not base pay; a posting without compensation posts none.
		expect(postings[1]?.pay).toEqual([]);
	});

	it("leaves out unlisted postings", () => {
		const board = fixture("ashby-board") as { jobs: Record<string, unknown>[] };
		const [first, ...rest] = board.jobs;
		expect(parseAshby({ jobs: [{ ...first, isListed: false }, ...rest] })).toHaveLength(2);
	});
});

describe("Lever", () => {
	it("reads postings with their salary range, workplace and listed sections", () => {
		const postings = parseLever(fixture("lever-postings"));
		expect(postings).toHaveLength(3);
		expect(postings[0]).toMatchObject({
			externalId: "e8a190f0-7a89-4c11-a6a0-452ff6234749",
			title: "Administrative Business Partner, Floater",
			location: "Foster City, CA",
			remote: false,
			workplace: "hybrid",
			url: "https://jobs.lever.co/zoox/e8a190f0-7a89-4c11-a6a0-452ff6234749",
			pay: [{ min: 123_000, max: 168_000, currency: "USD", period: "year" }],
			postedAt: new Date(1_791_307_664_932),
		});
		expect(postings[0]?.description).toContain("Responsibilities");
		expect(postings[2]).toMatchObject({ workplace: "onsite", pay: [] });
	});
});

describe("fetching", () => {
	const respond = (body: unknown, status = 200) =>
		new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

	it("asks each API once, at its own (EU) host, and Greenhouse once more for the board's name", async () => {
		const calls: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				calls.push(url);
				if (url.endsWith("/jobs")) return respond(fixture("greenhouse-jobs"));
				if (url.includes("greenhouse")) return respond(fixture("greenhouse-board"));
				if (url.includes("ashby")) return respond(fixture("ashby-board"));
				return respond(fixture("lever-postings"));
			}),
		);
		const signal = AbortSignal.timeout(5000);
		await expect(fetchBoard({ ats: "greenhouse", region: "eu", slug: "gitlab" }, signal, true)).resolves.toMatchObject({
			name: "GitLab",
			postings: expect.any(Array),
		});
		await fetchBoard({ ats: "ashby", region: "us", slug: "linear" }, signal);
		await fetchBoard({ ats: "lever", region: "eu", slug: "zoox" }, signal);
		expect(calls.sort()).toEqual([
			"https://api.ashbyhq.com/posting-api/job-board/linear?includeCompensation=true",
			"https://api.eu.lever.co/v0/postings/zoox?mode=json",
			"https://boards-api.eu.greenhouse.io/v1/boards/gitlab",
			"https://boards-api.eu.greenhouse.io/v1/boards/gitlab/jobs",
		]);
	});

	it("names a missing board, a down API and a reply that isn't a board", async () => {
		const signal = AbortSignal.timeout(5000);
		const ref = { ats: "lever", region: "us", slug: "nobody" } as const;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => respond({ ok: false }, 404)),
		);
		await expect(fetchBoard(ref, signal)).rejects.toMatchObject({ reason: "not-found" });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => respond({}, 503)),
		);
		await expect(fetchBoard(ref, signal)).rejects.toMatchObject({ reason: "unreachable" });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => respond({ ok: false })),
		);
		await expect(fetchBoard(ref, signal)).rejects.toBeInstanceOf(BoardError);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("<html>", { status: 200 })),
		);
		await expect(fetchBoard(ref, signal)).rejects.toMatchObject({ reason: "malformed" });
	});

	it("reads a Greenhouse job page with pay transparency on", async () => {
		const fetch = vi.fn(async () => respond(fixture("greenhouse-job")));
		vi.stubGlobal("fetch", fetch);
		const detail = await fetchGreenhouseDetail(
			{ ats: "greenhouse", region: "us", slug: "gitlab" },
			"8638232002",
			AbortSignal.timeout(5000),
		);
		expect(fetch).toHaveBeenCalledWith(
			"https://boards-api.greenhouse.io/v1/boards/gitlab/jobs/8638232002?pay_transparency=true",
			expect.anything(),
		);
		expect(detail.pay).toHaveLength(1);
	});
});

describe("websiteFromPostings", () => {
	it("takes the company's site from postings embedded on it, never the ATS's own host", () => {
		expect(websiteFromPostings([{ url: "https://job-boards.greenhouse.io/gitlab/jobs/1" }])).toBeNull();
		expect(
			websiteFromPostings([
				{ url: "https://jobs.lever.co/zoox/1" },
				{ url: "https://careers.acme.example/open-roles/?gh_jid=12" },
			]),
		).toBe("https://acme.example");
		expect(websiteFromPostings([{ url: "https://www.acme.example/jobs?gh_jid=3" }])).toBe("https://www.acme.example");
	});
});
