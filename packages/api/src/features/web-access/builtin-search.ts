import { parseDocument } from "htmlparser2";
import { fetchBuiltinPage } from "./builtin";
import { WebAccessError } from "./contracts";
import { normalizeSearch } from "./transport";

/**
 * DuckDuckGo's HTML results page, the one that works without JavaScript. Not an official API: it rate-limits, can
 * change without notice, and DuckDuckGo's terms don't sanction it, so it serves one person's self-hosted instance only
 * (`WEB_SEARCH_BUILTIN`), and only when no search service is set up.
 */
export const BUILTIN_SEARCH_URL = "https://html.duckduckgo.com/html/";

/** Searches over several regions run one after another with this gap, so one discovery run doesn't trip the block. */
export const BUILTIN_SEARCH_GAP_MS = 1_000;

export type BuiltinSearchOptions = {
	/** One ISO 3166-1 alpha-2 country, sent as DuckDuckGo's `kl` region. */
	region?: string | undefined;
	signal: AbortSignal;
	/** "Results from one search" (Settings → AI & developer → Web access). */
	maxResults: number;
};

// DuckDuckGo's own codes where they differ from the country and its likely language.
const REGION_OVERRIDES: Record<string, string> = {
	GB: "uk-en",
	JP: "jp-jp",
	KR: "kr-kr",
	NO: "no-no",
	HK: "hk-tzh",
	TW: "tw-tzh",
};

/** DuckDuckGo's `kl`: the country, then its likely language, as `searxng.ts` builds SearXNG's `language`. */
export function duckDuckGoRegion(region: string) {
	const country = region.toUpperCase();
	const override = REGION_OVERRIDES[country];
	if (override) return override;
	const { language } = new Intl.Locale(`und-${country}`).maximize();
	return `${country.toLowerCase()}-${language}`;
}

type ChildNode = ReturnType<typeof parseDocument>["children"][number];
type Element = Extract<ChildNode, { attribs: Record<string, string> }>;

const classes = (node: Element) => new Set((node.attribs.class ?? "").split(/\s+/).filter(Boolean));

function elements(nodes: ChildNode[], match: (node: Element) => boolean): Element[] {
	const found: Element[] = [];
	const visit = (node: ChildNode) => {
		if (node.type !== "tag" && node.type !== "script" && node.type !== "style") return;
		if (match(node)) found.push(node);
		for (const child of node.children) visit(child);
	};
	for (const node of nodes) visit(node);
	return found;
}

function text(node: ChildNode): string {
	if (node.type === "text") return node.data;
	if (node.type !== "tag") return "";
	return node.children.map(text).join("");
}
const clean = (value: string) => value.replace(/\s+/g, " ").trim();

/** DuckDuckGo wraps each link as `//duckduckgo.com/l/?uddg=<the real address>`; anything else on its own host is not a result. */
export function resultUrl(href: string): string | null {
	let url: URL;
	try {
		url = new URL(href, BUILTIN_SEARCH_URL);
	} catch {
		return null;
	}
	if (url.hostname === "duckduckgo.com" || url.hostname.endsWith(".duckduckgo.com")) {
		const target = url.pathname === "/l/" ? url.searchParams.get("uddg") : null;
		return target ? resultUrl(target) : null;
	}
	return url.toString();
}

/** Its bot check: a page with the `anomaly` challenge form instead of results. */
export function isBotCheck(html: string) {
	const document = parseDocument(html);
	return (
		elements(
			document.children,
			(node) =>
				(node.name === "form" && /anomaly/i.test(node.attribs.action ?? "")) ||
				[...classes(node)].some((name) => name.startsWith("anomaly-modal")),
		).length > 0
	);
}

/** Title, link and snippet of each organic result, in page order. Ads are skipped. */
export function parseDuckDuckGoResults(html: string) {
	const document = parseDocument(html);
	return elements(document.children, (node) => node.name === "div" && classes(node).has("result")).flatMap((result) => {
		const names = classes(result);
		if (names.has("result--ad") || names.has("result--ad--small")) return [];
		const [anchor] = elements(result.children, (node) => node.name === "a" && classes(node).has("result__a"));
		const url = anchor?.attribs.href ? resultUrl(anchor.attribs.href) : null;
		const title = anchor ? clean(text(anchor)) : "";
		if (!url || !title) return [];
		const [snippet] = elements(result.children, (node) => classes(node).has("result__snippet"));
		const description = snippet ? clean(text(snippet)) : "";
		return [{ url, title, ...(description ? { snippet: description } : {}) }];
	});
}

/**
 * One search through DuckDuckGo with the built-in reader's fetch (public hosts only, the size cap, the call's time
 * limit). A 202 or the bot check page means DuckDuckGo won't serve the search: `rate-limit`. A page without results
 * is an empty result.
 */
export async function searchBuiltin(query: string, { region, signal, maxResults }: BuiltinSearchOptions) {
	const url = new URL(BUILTIN_SEARCH_URL);
	url.searchParams.set("q", query);
	if (region) url.searchParams.set("kl", duckDuckGoRegion(region));
	const page = await fetchBuiltinPage(url.toString(), signal);
	if (page.status === 202 || isBotCheck(page.html)) throw new WebAccessError("rate-limit");
	return normalizeSearch(parseDuckDuckGoResults(page.html), maxResults);
}
