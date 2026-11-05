import z from "zod";

/** The applicant tracking systems whose public job boards can be watched. */
export const boardAtsSchema = z.enum(["greenhouse", "ashby", "lever"]);
export type BoardAts = z.infer<typeof boardAtsSchema>;

/** Greenhouse and Lever also host boards in the EU, on their own hosts. Ashby has one host. */
export const boardRegionSchema = z.enum(["us", "eu"]);
export type BoardRegion = z.infer<typeof boardRegionSchema>;

const SLUG = /^[\w][\w.-]{0,99}$/;
export const boardSlugSchema = z.string().trim().regex(SLUG, "Not a jobs page name.");

/** A board as the user picks it. The API host comes from these, never from the client. */
export const boardRefSchema = z.object({
	ats: boardAtsSchema,
	region: boardRegionSchema.default("us"),
	slug: boardSlugSchema,
});
export type BoardRef = z.infer<typeof boardRefSchema>;

/** How a watched board was found. */
export const boardSourceSchema = z.enum(["posting", "link", "guess"]);
export type BoardSource = z.infer<typeof boardSourceSchema>;

/** One pay range a board posts, as yearly, monthly or hourly base pay. */
export const boardPaySchema = z.object({
	min: z.number().nonnegative().nullable(),
	max: z.number().nonnegative().nullable(),
	currency: z.string().regex(/^[A-Z]{3}$/),
	period: z.enum(["hour", "month", "year"]),
});
export type BoardPay = z.infer<typeof boardPaySchema>;

const API_HOSTS: Record<BoardAts, Record<BoardRegion, string>> = {
	greenhouse: { us: "boards-api.greenhouse.io", eu: "boards-api.eu.greenhouse.io" },
	ashby: { us: "api.ashbyhq.com", eu: "api.ashbyhq.com" },
	lever: { us: "api.lever.co", eu: "api.eu.lever.co" },
};

export const boardApiHost = ({ ats, region }: Pick<BoardRef, "ats" | "region">) => API_HOSTS[ats][region];

/** The region a stored API host belongs to. */
export const boardRegionOf = (host: string): BoardRegion => (/\.eu\./.test(host) ? "eu" : "us");

/** The board's public page, for people to look at. */
export function boardPageUrl({ ats, region, slug }: BoardRef) {
	const eu = region === "eu" && ats !== "ashby" ? "eu." : "";
	const host = { greenhouse: `job-boards.${eu}greenhouse.io`, ashby: "jobs.ashbyhq.com", lever: `jobs.${eu}lever.co` }[
		ats
	];
	return `https://${host}/${encodeURIComponent(slug)}`;
}

/**
 * The board a Greenhouse, Ashby or Lever address belongs to: a board page, one of its postings, an embed or an API
 * address. Anything else is null.
 */
export function boardFromUrl(input: string): BoardRef | null {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	const host = url.hostname.toLowerCase();
	const parts = url.pathname
		.split("/")
		.filter(Boolean)
		.map((part) => {
			try {
				return decodeURIComponent(part);
			} catch {
				return "";
			}
		});
	const ref = (ats: BoardAts, region: BoardRegion, slug: string | null | undefined) =>
		slug && SLUG.test(slug) ? { ats, region, slug } : null;

	const greenhouse = /^(?:boards|job-boards)(\.eu)?\.greenhouse\.io$/.exec(host);
	if (greenhouse) {
		const region = greenhouse[1] ? "eu" : "us";
		if (parts[0] === "embed") return ref("greenhouse", region, url.searchParams.get("for"));
		return ref("greenhouse", region, parts[0]);
	}
	const greenhouseApi = /^boards-api(\.eu)?\.greenhouse\.io$/.exec(host);
	if (greenhouseApi && parts[0] === "v1" && parts[1] === "boards")
		return ref("greenhouse", greenhouseApi[1] ? "eu" : "us", parts[2]);
	if (host === "jobs.ashbyhq.com") return ref("ashby", "us", parts[0]);
	if (host === "api.ashbyhq.com" && parts[0] === "posting-api" && parts[1] === "job-board")
		return ref("ashby", "us", parts[2]);
	const lever = /^jobs(\.eu)?\.lever\.co$/.exec(host);
	if (lever) return ref("lever", lever[1] ? "eu" : "us", parts[0]);
	const leverApi = /^api(\.eu)?\.lever\.co$/.exec(host);
	if (leverApi && parts[0] === "v0" && parts[1] === "postings")
		return ref("lever", leverApi[1] ? "eu" : "us", parts[2]);
	return null;
}

/**
 * Every board a careers page points at: links to board pages or postings, and Greenhouse embeds
 * (`job_board?for=acme`). Distinct boards, in the order the page names them.
 */
export function boardsInHtml(html: string): BoardRef[] {
	const found = new Map<string, BoardRef>();
	const pattern =
		/https?:\/\/(?:(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io|jobs\.ashbyhq\.com|jobs(?:\.eu)?\.lever\.co)\/[^\s"'<>)\\]*/gi;
	for (const match of html.slice(0, 2_000_000).matchAll(pattern)) {
		const ref = boardFromUrl(match[0].replaceAll("&amp;", "&"));
		if (ref) found.set(`${ref.ats}:${ref.region}:${ref.slug.toLowerCase()}`, ref);
		if (found.size >= 10) break;
	}
	return [...found.values()];
}

const LEGAL =
	/\b(?:inc|llc|ltd|limited|gmbh|ag|sa|sas|bv|plc|corp|corporation|co|company|group|holdings|technologies|labs)\b\.?/gi;

/**
 * Board names a company is likely to use: "Acme Robotics, Inc." gives acmerobotics, acme-robotics and acme. A guess
 * often finds nothing, and sometimes finds another company's board, so a guess is only ever shown for confirming.
 */
export function boardSlugGuesses(companyName: string): string[] {
	const ascii = companyName
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/&/g, " and ")
		.toLowerCase();
	const words = ascii
		.replace(LEGAL, " ")
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	if (!words.length) return [];
	const guesses = [words.join(""), words.join("-"), words[0] ?? ""];
	return [...new Set(guesses)].filter((slug) => slug.length >= 2 && SLUG.test(slug)).slice(0, 3);
}

const PERIOD_WORDS: Record<BoardPay["period"], string> = { hour: "an hour", month: "a month", year: "a year" };

/** "USD 139,200–235,200 a year", for an application's salary field. Ranges after the first are left out. */
export function formatBoardPay(pay: BoardPay[], locale = "en-US") {
	const range = pay[0];
	if (!range) return "";
	const amount = (value: number | null) =>
		value === null ? "" : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
	const span = [range.min, range.max].filter((value) => value !== null);
	const shown =
		span.length === 2 && range.min !== range.max
			? `${amount(range.min)}–${amount(range.max)}`
			: amount(span[0] ?? null);
	return `${range.currency} ${shown} ${PERIOD_WORDS[range.period]}`;
}

/** The platforms by the names users know them by. */
export const BOARD_ATS_NAMES: Record<BoardAts, string> = { greenhouse: "Greenhouse", ashby: "Ashby", lever: "Lever" };

/** Where a find on a watched company came from, for an application's source: the platform by name, or "Careers page". */
export const boardSourceName = (url: string) => {
	const ref = boardFromUrl(url);
	return ref ? BOARD_ATS_NAMES[ref.ats] : "Careers page";
};
