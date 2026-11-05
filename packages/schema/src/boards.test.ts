import { describe, expect, it } from "vitest";
import { boardFromUrl, boardPageUrl, boardSlugGuesses, boardsInHtml, formatBoardPay, boardSourceName } from "./boards";

describe("boardFromUrl", () => {
	it("reads board pages, postings, embeds and API addresses", () => {
		expect(boardFromUrl("https://job-boards.greenhouse.io/gitlab/jobs/8771512002")).toEqual({
			ats: "greenhouse",
			region: "us",
			slug: "gitlab",
		});
		expect(boardFromUrl("https://boards.eu.greenhouse.io/acme")).toEqual({
			ats: "greenhouse",
			region: "eu",
			slug: "acme",
		});
		expect(boardFromUrl("https://boards.greenhouse.io/embed/job_board?for=acme&b=x")).toEqual({
			ats: "greenhouse",
			region: "us",
			slug: "acme",
		});
		expect(boardFromUrl("https://boards-api.greenhouse.io/v1/boards/acme/jobs")).toMatchObject({ slug: "acme" });
		expect(boardFromUrl("https://jobs.ashbyhq.com/linear/12f8f208-0b9c-4569-bb3d-41c8a197029e")).toEqual({
			ats: "ashby",
			region: "us",
			slug: "linear",
		});
		expect(boardFromUrl("https://jobs.eu.lever.co/acme/1234")).toEqual({ ats: "lever", region: "eu", slug: "acme" });
		expect(boardFromUrl("https://api.lever.co/v0/postings/zoox?mode=json")).toMatchObject({
			ats: "lever",
			slug: "zoox",
		});
	});

	it("is null for anything else", () => {
		expect(boardFromUrl("https://acme.example/careers")).toBeNull();
		expect(boardFromUrl("https://jobs.lever.co/")).toBeNull();
		expect(boardFromUrl("https://jobs.ashbyhq.com/%2E%2E")).toBeNull();
		expect(boardFromUrl("not a link")).toBeNull();
		expect(boardFromUrl("ftp://jobs.lever.co/acme")).toBeNull();
	});

	it("round-trips through the board's page", () => {
		for (const ref of [
			{ ats: "greenhouse", region: "eu", slug: "acme" },
			{ ats: "ashby", region: "us", slug: "linear" },
			{ ats: "lever", region: "eu", slug: "zoox" },
		] as const)
			expect(boardFromUrl(boardPageUrl(ref))).toEqual(ref);
	});
});

describe("boardsInHtml", () => {
	it("finds each board a careers page links to or embeds, once", () => {
		const html = `
			<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>
			<a href="https://boards.greenhouse.io/embed/job_board?for=acme&amp;b=https://acme.example">Jobs</a>
			<a href="https://jobs.lever.co/acme-eu/abc">One role</a>
			<a href="https://example.com/jobs">Elsewhere</a>`;
		expect(boardsInHtml(html)).toEqual([
			{ ats: "greenhouse", region: "us", slug: "acme" },
			{ ats: "lever", region: "us", slug: "acme-eu" },
		]);
	});
});

describe("boardSlugGuesses", () => {
	it("joins, hyphenates and shortens the name, without legal suffixes or accents", () => {
		expect(boardSlugGuesses("Acme Robotics, Inc.")).toEqual(["acmerobotics", "acme-robotics", "acme"]);
		expect(boardSlugGuesses("Zoox")).toEqual(["zoox"]);
		expect(boardSlugGuesses("Café Société GmbH")).toEqual(["cafesociete", "cafe-societe", "cafe"]);
		expect(boardSlugGuesses("Inc.")).toEqual([]);
	});
});

describe("formatBoardPay and boardSourceName", () => {
	it("writes the first range for an application's salary", () => {
		expect(formatBoardPay([{ min: 139_200, max: 235_200, currency: "USD", period: "year" }])).toBe(
			"USD 139,200–235,200 a year",
		);
		expect(formatBoardPay([{ min: null, max: 45, currency: "EUR", period: "hour" }])).toBe("EUR 45 an hour");
		expect(formatBoardPay([])).toBe("");
	});

	it("names the board's ATS", () => {
		expect(boardSourceName("https://jobs.ashbyhq.com/linear/1")).toBe("Ashby");
		expect(boardSourceName("https://acme.example/jobs?gh_jid=1")).toBe("Job board");
	});
});
