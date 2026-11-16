import type {
	ProviderRequest,
	ReadPageResult,
	WebAccessConnection,
	WebAccessContext,
	WebAccessFailure,
} from "./contracts";
import { env } from "@reactive-resume/env/server";
import { rateLimitConfig } from "@reactive-resume/utils/rate-limit";
import { abortable } from "@reactive-resume/utils/url-security.node";
import { createRateLimiter } from "../../redis";
import { assertPublicTarget, htmlToText, readBuiltinPage } from "./builtin";
import { BUILTIN_SEARCH_GAP_MS, searchBuiltin } from "./builtin-search";
import { MAX_SEARCH_QUERY_CHARS, WebAccessError } from "./contracts";
import { webAccessService } from "./credentials";
import { readExa, searchExa } from "./exa";
import { readFirecrawl, searchFirecrawl } from "./firecrawl";
import { webLimits } from "./limits";
import { searchSearxng } from "./searxng";
import { readTavily, searchTavily } from "./tavily";
import { normalizeSearch, pageContent, safeFailure } from "./transport";

const limiter = createRateLimiter("web-access", rateLimitConfig.orpc.aiRequest);

async function consume(userId: string, signal: AbortSignal) {
	signal.throwIfAborted();
	if (process.env.NODE_ENV !== "production" || env.FLAG_DISABLE_API_RATE_LIMIT) return;
	const { success } = await abortable(limiter.limit(userId), signal);
	if (!success) throw new WebAccessError("rate-limit");
}

// Settings → AI & developer → Web access. Search services get 6 seconds less, so their own timeout reports first.
const deadline = (timeoutMs: number, signal?: AbortSignal) =>
	AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]);
const serviceTimeout = (timeoutMs: number) => Math.max(1_000, timeoutMs - 6_000);

async function externalSearch(query: string, options: ProviderRequest) {
	try {
		switch (options.connection.provider) {
			case "firecrawl":
				return await searchFirecrawl(query, options);
			case "tavily":
				return await searchTavily(query, options);
			case "exa":
				return await searchExa(query, options);
		}
	} catch (error) {
		throw safeFailure(error, options.signal);
	}
}

async function externalRead(url: string, options: ProviderRequest) {
	try {
		switch (options.connection.provider) {
			case "firecrawl":
				return await readFirecrawl(url, options);
			case "tavily":
				return await readTavily(url, options);
			case "exa":
				return await readExa(url, options);
		}
	} catch (error) {
		throw safeFailure(error, options.signal);
	}
}

function log(operation: "search" | "read", provider: string, started: number, outcome: string, fallback?: string) {
	console.info("[web-access]", {
		provider,
		operation,
		durationMs: Date.now() - started,
		outcome,
		...(fallback ? { fallback } : {}),
	});
}

function searchInput(query: string) {
	const input = query.trim();
	if (!input || input.length > MAX_SEARCH_QUERY_CHARS) throw new WebAccessError("malformed");
	return input;
}

/**
 * Deduplicates by URL and takes results round-robin in region order, so each region that returned anything shows.
 * Keeps the first `maxResults` ("Results from one search").
 */
function interleave<T extends { url: string }>(lists: T[][], maxResults: number) {
	const seen = new Set<string>();
	const merged: T[] = [];
	const longest = Math.max(...lists.map((list) => list.length));
	for (let index = 0; index < longest; index++) {
		for (const list of lists) {
			const item = list[index];
			if (!item || seen.has(item.url)) continue;
			seen.add(item.url);
			merged.push(item);
		}
	}
	return merged.slice(0, maxResults);
}

type SearchResults = Awaited<ReturnType<typeof externalSearch>>;
type WebLimits = Awaited<ReturnType<typeof webLimits>>;

type SearchBackend = {
	name: string;
	/** Regions run one after another with a gap instead of in parallel. */
	paced?: boolean;
	search: (query: string, region?: string) => Promise<SearchResults>;
};

/**
 * Where searches go: the operator's SearXNG when set, otherwise the web connection's provider, otherwise, with no
 * service set up at all, the built-in DuckDuckGo search. A service that is set up but failing never falls back to it.
 */
async function searchBackend(
	context: WebAccessContext,
	signal: AbortSignal,
	limits: WebLimits,
): Promise<SearchBackend | null> {
	const maxResults = limits.searchResults;
	const baseUrl = env.WEB_SEARCH_SEARXNG_URL;
	if (baseUrl)
		return {
			name: "searxng",
			search: (query, region) => searchSearxng(query, { baseUrl, region, signal, maxResults }),
		};
	const connection = context.connection;
	if (!connection)
		return (await webAccessService.usesBuiltInSearch(context.userId))
			? {
					name: "builtin",
					paced: true,
					search: (query, region) => searchBuiltin(query, { region, signal, maxResults }),
				}
			: null;
	const request = {
		connection,
		signal,
		serviceTimeoutMs: serviceTimeout(limits.timeoutMs),
		maxResults,
		maxChars: limits.pageChars,
	};
	return {
		name: connection.provider,
		search: (query, region) => externalSearch(query, region ? { ...request, region } : request),
	};
}

function pause(ms: number, signal: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", stop);
			resolve();
		}, ms);
		const stop = () => {
			clearTimeout(timer);
			reject(signal.reason);
		};
		signal.addEventListener("abort", stop, { once: true });
	});
}

/**
 * Region searches one after another with a gap between them. Once one is blocked (`rate-limit`) the rest are
 * skipped, since they would be blocked too.
 */
async function inSequence<T>(tasks: (() => Promise<T>)[], gapMs: number, signal: AbortSignal) {
	const settled: PromiseSettledResult<T>[] = [];
	for (const [index, task] of tasks.entries()) {
		if (index > 0) await pause(gapMs, signal);
		try {
			settled.push({ status: "fulfilled", value: await task() });
		} catch (reason) {
			settled.push({ status: "rejected", reason });
			if (reason instanceof WebAccessError && reason.reason === "rate-limit") break;
		}
	}
	return settled;
}

/**
 * One rate-limited search. Each region gets its own search call, with `queryFor(region)` as its query when given,
 * in parallel under one deadline (one after another for the built-in search). A failed region drops out unless every
 * region fails.
 */
export async function searchWeb(query: string, context: WebAccessContext, queryFor?: (region: string) => string) {
	const limits = await webLimits(context.userId);
	const signal = deadline(limits.timeoutMs, context.signal);
	const started = Date.now();
	// Chosen inside the try below: finding out whether the built-in search applies reads the database.
	let provider = context.connection?.provider ?? "builtin";
	let usedFallback = false;
	let failureRecorded: Promise<void> | undefined;
	const rememberFailure = async (error: unknown) => {
		if (
			!signal.aborted &&
			provider !== "searxng" &&
			error instanceof WebAccessError &&
			(error.reason === "auth" || error.reason === "quota")
		) {
			const result = { success: false, error: error.reason };
			await (failureRecorded ??= webAccessService
				.recordTest(context.userId, context.connection, { search: result, read: result })
				.catch(() => undefined));
		}
	};
	try {
		const backend = await searchBackend(context, signal, limits);
		provider = backend?.name ?? "builtin";
		await consume(context.userId, signal);
		if (!backend) throw new WebAccessError("unavailable");
		const search = async (query: string, region?: string) => {
			try {
				return await backend.search(query, region);
			} catch (error) {
				if (
					signal.aborted ||
					!context.fallbackSearch ||
					!(error instanceof WebAccessError) ||
					(error.reason !== "auth" && error.reason !== "quota")
				)
					throw error;
				await rememberFailure(error);
				signal.throwIfAborted();
				usedFallback = true;
				return normalizeSearch(await context.fallbackSearch(query, region, signal), limits.searchResults);
			}
		};
		const input = searchInput(query);
		const searches = (context.regions ?? []).map((region) => ({
			region,
			query: queryFor ? searchInput(queryFor(region)) : input,
		}));
		let results: SearchResults;
		let partial: string | undefined;
		if (searches.length === 0) results = await search(input);
		else {
			const tasks = searches.map((entry) => () => search(entry.query, entry.region));
			const settled = backend.paced
				? await inSequence(tasks, BUILTIN_SEARCH_GAP_MS, signal)
				: await Promise.allSettled(tasks.map((task) => task()));
			const lists = settled.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value] : []));
			if (lists.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
			// A paced search stops at a block, so the regions it skipped count as failed.
			const failed = searches.length - lists.length;
			if (failed) partial = `${failed}/${searches.length}-regions-failed`;
			results = interleave(lists, limits.searchResults);
		}
		signal.throwIfAborted();
		log("search", usedFallback ? `${provider}+ai-native` : provider, started, "success", partial);
		return results;
	} catch (error) {
		await rememberFailure(error);
		log(
			"search",
			usedFallback ? `${provider}+ai-native` : provider,
			started,
			signal.aborted ? "aborted" : error instanceof WebAccessError ? error.reason : "unreachable",
		);
		throw safeFailure(error, signal);
	}
}

/** One deadline covers DNS, the selected provider, and the direct fallback. Cancellation never falls back. */
export async function readPage(input: string, context: WebAccessContext): Promise<ReadPageResult> {
	const { timeoutMs, pageChars, searchResults } = await webLimits(context.userId);
	const signal = deadline(timeoutMs, context.signal);
	const started = Date.now();
	const provider = context.connection?.provider ?? "builtin";
	let fallback: WebAccessFailure | undefined;
	try {
		await consume(context.userId, signal);
		const url = await assertPublicTarget(input, signal);
		if (context.connection) {
			// Reserve five seconds of the same overall budget for the direct reader.
			const externalBudget = Math.max(1, timeoutMs - (Date.now() - started) - 5_000);
			const externalSignal = AbortSignal.any([signal, AbortSignal.timeout(externalBudget)]);
			try {
				// Remote services must independently protect their own redirects and DNS lookups.
				const page = await externalRead(url.toString(), {
					connection: context.connection,
					signal: externalSignal,
					serviceTimeoutMs: serviceTimeout(timeoutMs),
					maxResults: searchResults,
					maxChars: pageChars,
				});
				if (page.resolvedUrl) await assertPublicTarget(page.resolvedUrl, externalSignal);
				const content = pageContent(page.content, pageChars);
				externalSignal.throwIfAborted();
				log("read", provider, started, "success");
				return {
					...page,
					...content,
					requestedUrl: url.toString(),
					retrievedAt: new Date().toISOString(),
					method: context.connection.provider,
				};
			} catch (error) {
				signal.throwIfAborted();
				const failure = safeFailure(error, externalSignal);
				if (failure.reason === "unsafe-url") throw failure;
				fallback = failure.reason;
				if (failure.reason === "auth" || failure.reason === "quota") {
					const result = { success: false, error: failure.reason };
					await webAccessService
						.recordTest(context.userId, context.connection, { search: result, read: result })
						.catch(() => undefined);
				}
			}
		}
		const page = await readBuiltinPage(url.toString(), signal);
		const content = pageContent(htmlToText(page.html), pageChars);
		signal.throwIfAborted();
		log("read", provider, started, "success", fallback ? `${fallback}:builtin` : undefined);
		return {
			...page,
			...content,
			requestedUrl: url.toString(),
			retrievedAt: new Date().toISOString(),
			method: "builtin",
			format: "text",
			...(fallback ? { fallbackReason: fallback } : {}),
		};
	} catch (error) {
		log(
			"read",
			provider,
			started,
			signal.aborted ? "aborted" : error instanceof WebAccessError ? error.reason : "unreachable",
			fallback ? `${fallback}:failed` : undefined,
		);
		throw safeFailure(error, signal);
	}
}

/**
 * Explicit settings test. Provider operations are independent and never use the built-in fallback. Search is tested
 * against SearXNG when the server sends searches there, and the log names which service each operation tested.
 * Without a connection, reading is not tested and reports `unavailable`: only the built-in reader serves it.
 */
export async function probeWebAccess(
	connection: WebAccessConnection | null,
	context: { userId: string; signal?: AbortSignal | undefined; region?: string | undefined },
) {
	const { timeoutMs, pageChars, searchResults } = await webLimits(context.userId);
	const signal = deadline(timeoutMs, context.signal);
	const request = {
		signal,
		serviceTimeoutMs: serviceTimeout(timeoutMs),
		maxResults: searchResults,
		maxChars: pageChars,
	};
	await consume(context.userId, signal);
	const searxng = env.WEB_SEARCH_SEARXNG_URL;
	const probe = async (operation: "search" | "read") => {
		const started = Date.now();
		const provider = operation === "search" && searxng ? "searxng" : (connection?.provider ?? "builtin");
		try {
			if (operation === "search" && searxng)
				await searchSearxng("example domain", {
					baseUrl: searxng,
					region: context.region,
					signal,
					maxResults: searchResults,
				});
			else if (!connection) throw new WebAccessError("unavailable");
			else if (operation === "search")
				await externalSearch("example domain", { ...request, connection, region: context.region });
			else {
				const url = await assertPublicTarget("https://example.com/", signal);
				const page = await externalRead(url.toString(), { ...request, connection });
				pageContent(page.content, pageChars);
				if (page.resolvedUrl) await assertPublicTarget(page.resolvedUrl, signal);
			}
			signal.throwIfAborted();
			log(operation, provider, started, "success");
			return { success: true };
		} catch (error) {
			const failure = safeFailure(error, signal);
			log(operation, provider, started, failure.reason);
			return { success: false, error: failure.reason };
		}
	};
	const [search, read] = await Promise.all([probe("search"), probe("read")]);
	return { search, read };
}
