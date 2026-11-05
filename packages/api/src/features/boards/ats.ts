import type { BoardAts, BoardPay, BoardRef } from "@reactive-resume/schema/boards";
import { boardApiHost } from "@reactive-resume/schema/boards";
import { htmlToText } from "../web-access/builtin";

/** One posting as a board lists it. */
export type BoardPosting = {
	externalId: string;
	title: string;
	location: string;
	remote: boolean;
	workplace: "remote" | "hybrid" | "onsite" | null;
	url: string;
	pay: BoardPay[];
	description: string;
	postedAt: Date | null;
};

export type BoardListing = { name: string | null; postings: BoardPosting[] };

export type BoardFailure = "not-found" | "unreachable" | "malformed" | "too-large";

export class BoardError extends Error {
	constructor(readonly reason: BoardFailure) {
		super(`Job board ${reason}`);
	}
}

/** Ashby boards can send 6 MB; a board several times that size is not one to poll. */
const MAX_BOARD_BYTES = 24_000_000;
const MAX_TEXT = 20_000;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const record = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const date = (value: unknown) => {
	const parsed = typeof value === "number" || typeof value === "string" ? new Date(value) : null;
	return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
};
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
const currency = (value: unknown) => {
	const code = text(value).toUpperCase();
	return /^[A-Z]{3}$/.test(code) ? code : null;
};
/** Some boards escape their HTML ("&lt;p&gt;"), so one pass leaves tags behind. */
const richText = (html: string) => {
	const once = htmlToText(html);
	return (/<\/?[a-z][^<>]*>/i.test(once) ? htmlToText(once) : once).slice(0, MAX_TEXT);
};
const workplaceOf = (value: unknown): BoardPosting["workplace"] => {
	const kind = text(value)
		.toLowerCase()
		.replace(/[^a-z]/g, "");
	return kind === "remote" ? "remote" : kind === "hybrid" ? "hybrid" : kind === "onsite" ? "onsite" : null;
};
const saysRemote = (location: string) => /\bremote\b/i.test(location);

/** The base path of one board's API. */
function apiBase({ ats, region, slug }: BoardRef) {
	const host = boardApiHost({ ats, region });
	const name = encodeURIComponent(slug);
	return {
		greenhouse: `https://${host}/v1/boards/${name}`,
		ashby: `https://${host}/posting-api/job-board/${name}`,
		lever: `https://${host}/v0/postings/${name}`,
	}[ats];
}

/** One GET to a board API's fixed host. Error bodies are never kept. */
async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
	let response: Response;
	try {
		response = await fetch(url, { headers: { accept: "application/json" }, signal, redirect: "error" });
	} catch {
		throw new BoardError("unreachable");
	}
	if (!response.ok) {
		await response.body?.cancel().catch(() => {});
		throw new BoardError(response.status === 404 ? "not-found" : "unreachable");
	}
	if (Number(response.headers.get("content-length")) > MAX_BOARD_BYTES) {
		await response.body?.cancel().catch(() => {});
		throw new BoardError("too-large");
	}
	const reader = response.body?.getReader();
	if (!reader) throw new BoardError("malformed");
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > MAX_BOARD_BYTES) throw new BoardError("too-large");
			chunks.push(value);
		}
	} catch (error) {
		if (error instanceof BoardError) throw error;
		throw new BoardError("unreachable");
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
	} catch {
		throw new BoardError("malformed");
	}
}

// ---- Greenhouse ----

/** Greenhouse pay ranges are in cents with no period; a top under 500 a unit is hourly. */
export function parseGreenhousePay(ranges: unknown): BoardPay[] {
	return list(ranges).flatMap((item) => {
		const range = record(item);
		const code = currency(range.currency_type);
		const min = number(range.min_cents);
		const max = number(range.max_cents);
		if (!code || (min === null && max === null)) return [];
		const top = (max ?? min ?? 0) / 100;
		return [
			{
				min: min === null ? null : min / 100,
				max: max === null ? null : max / 100,
				currency: code,
				period: top < 500 ? ("hour" as const) : ("year" as const),
			},
		];
	});
}

export function parseGreenhouseJob(item: unknown): BoardPosting | null {
	const job = record(item);
	const id = job.id;
	const title = text(job.title);
	const url = text(job.absolute_url);
	if ((typeof id !== "number" && typeof id !== "string") || !title || !url) return null;
	const location = text(record(job.location).name);
	return {
		externalId: String(id),
		title,
		location,
		remote: saysRemote(location),
		workplace: saysRemote(location) ? "remote" : /\bhybrid\b/i.test(location) ? "hybrid" : null,
		url,
		pay: parseGreenhousePay(job.pay_input_ranges),
		description: job.content ? richText(text(job.content)) : "",
		postedAt: date(job.first_published) ?? date(job.updated_at),
	};
}

export function parseGreenhouse(json: unknown): BoardPosting[] {
	return list(record(json).jobs).flatMap((item) => parseGreenhouseJob(item) ?? []);
}

// ---- Ashby ----

const ASHBY_PERIODS: Record<string, BoardPay["period"]> = { "1 YEAR": "year", "1 MONTH": "month", "1 HOUR": "hour" };

export function parseAshbyPay(compensation: unknown): BoardPay[] {
	return list(record(compensation).summaryComponents).flatMap((item) => {
		const part = record(item);
		const period = ASHBY_PERIODS[text(part.interval).toUpperCase()];
		const code = currency(part.currencyCode);
		const min = number(part.minValue);
		const max = number(part.maxValue);
		if (text(part.compensationType) !== "Salary" || !period || !code || (min === null && max === null)) return [];
		return [{ min, max, currency: code, period }];
	});
}

export function parseAshby(json: unknown): BoardPosting[] {
	return list(record(json).jobs).flatMap((item) => {
		const job = record(item);
		const id = text(job.id);
		const title = text(job.title);
		const url = text(job.jobUrl);
		if (!id || !title || !url || job.isListed === false) return [];
		const places = [
			text(job.location),
			...list(job.secondaryLocations).map((place) => text(record(place).location)),
		].filter(Boolean);
		const workplace = workplaceOf(job.workplaceType);
		const remote = job.isRemote === true || workplace === "remote";
		return [
			{
				externalId: id,
				title,
				location: [...new Set(places)].join(" · "),
				remote,
				workplace: workplace ?? (remote ? "remote" : null),
				url,
				pay: parseAshbyPay(job.compensation),
				description: (text(job.descriptionPlain) || richText(text(job.descriptionHtml))).slice(0, MAX_TEXT),
				postedAt: date(job.publishedAt),
			},
		];
	});
}

// ---- Lever ----

const LEVER_PERIODS: Record<string, BoardPay["period"]> = {
	"per-year-salary": "year",
	"per-month-salary": "month",
	"per-hour-wage": "hour",
};

export function parseLeverPay(range: unknown): BoardPay[] {
	const pay = record(range);
	const period = LEVER_PERIODS[text(pay.interval)];
	const code = currency(pay.currency);
	const min = number(pay.min);
	const max = number(pay.max);
	return period && code && (min !== null || max !== null) ? [{ min, max, currency: code, period }] : [];
}

export function parseLever(json: unknown): BoardPosting[] {
	return list(json).flatMap((item) => {
		const job = record(item);
		const id = text(job.id);
		const title = text(job.text);
		const url = text(job.hostedUrl);
		if (!id || !title || !url) return [];
		const categories = record(job.categories);
		const places = [text(categories.location), ...list(categories.allLocations).map(text)].filter(Boolean);
		const location = [...new Set(places)].join(" · ");
		const workplace = workplaceOf(job.workplaceType);
		const sections = list(job.lists).map((entry) => {
			const section = record(entry);
			return `${text(section.text)}\n${richText(text(section.content))}`;
		});
		return [
			{
				externalId: id,
				title,
				location,
				remote: workplace === "remote" || saysRemote(location),
				workplace,
				url,
				pay: parseLeverPay(job.salaryRange),
				description: [text(job.descriptionPlain), ...sections, text(job.additionalPlain)]
					.filter(Boolean)
					.join("\n\n")
					.slice(0, MAX_TEXT),
				postedAt: date(job.createdAt),
			},
		];
	});
}

const PARSERS: Record<BoardAts, (json: unknown) => BoardPosting[]> = {
	greenhouse: parseGreenhouse,
	ashby: parseAshby,
	lever: parseLever,
};

/**
 * A board's open postings, in one GET. A Greenhouse board's own name costs a second one, so it's read only when
 * `withName` asks (to show the user what they're confirming). Ashby and Lever give no name.
 */
export async function fetchBoard(ref: BoardRef, signal: AbortSignal, withName = false): Promise<BoardListing> {
	const base = apiBase(ref);
	const url =
		ref.ats === "ashby"
			? `${base}?includeCompensation=true`
			: ref.ats === "lever"
				? `${base}?mode=json`
				: `${base}/jobs`;
	const [json, about] = await Promise.all([
		getJson(url, signal),
		withName && ref.ats === "greenhouse" ? getJson(base, signal).catch(() => null) : null,
	]);
	if (ref.ats === "lever" ? !Array.isArray(json) : !Array.isArray(record(json).jobs)) throw new BoardError("malformed");
	return { name: text(record(about).name) || null, postings: PARSERS[ref.ats](json) };
}

/** A Greenhouse job's own page: its full text and pay, which the board's list leaves out. */
export async function fetchGreenhouseDetail(ref: BoardRef, externalId: string, signal: AbortSignal) {
	const json = await getJson(`${apiBase(ref)}/jobs/${encodeURIComponent(externalId)}?pay_transparency=true`, signal);
	const job = parseGreenhouseJob(json);
	if (!job) throw new BoardError("malformed");
	return { description: job.description, pay: job.pay };
}

const ATS_HOSTS = /(?:^|\.)(?:greenhouse\.io|ashbyhq\.com|lever\.co)$/i;

/**
 * The company's website, from postings linked on its own site (a Greenhouse board embedded in its careers page). Board
 * pages on the ATS's own host say nothing about it.
 */
export function websiteFromPostings(postings: Pick<BoardPosting, "url">[]): string | null {
	for (const posting of postings) {
		try {
			const url = new URL(posting.url);
			if (url.protocol !== "https:" || ATS_HOSTS.test(url.hostname)) continue;
			// careers.acme.com is the careers site; the company's own is acme.com.
			const host = url.hostname.toLowerCase().replace(/^(?:careers|jobs|job|work|apply)\.(?=[^.]+\.[^.]+)/, "");
			return `https://${host}`;
		} catch {
			// Not a URL: try the next posting.
		}
	}
	return null;
}
