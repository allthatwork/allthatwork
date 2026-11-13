import z from "zod";

export const webAccessProviderSchema = z.enum(["firecrawl", "tavily", "exa"]);
export type WebAccessProvider = z.infer<typeof webAccessProviderSchema>;

/** Resolved on the server for each request; never accepted as a tool input. */
export type WebAccessConnection = {
	provider: WebAccessProvider;
	apiKey?: string;
	apiUrl?: string;
};

export type WebAccessContext = {
	connection: WebAccessConnection | null;
	userId: string;
	signal?: AbortSignal | undefined;
};

export type ReadPageResult = {
	requestedUrl: string;
	resolvedUrl?: string;
	content: string;
	format: "text" | "markdown";
	/** Time received by this application, not necessarily an origin fetch. */
	retrievedAt: string;
	providerFetchedAt?: string;
	method: "builtin" | WebAccessProvider;
	truncated: boolean;
	completeness: "unknown" | "incomplete";
	fallbackReason?: WebAccessFailure;
	/** Bounded server-only input for JobPosting parsing. */
	html?: string;
};

export type WebAccessFailure =
	| "unsafe-url"
	| "unreachable"
	| "not-a-page"
	| "too-large"
	| "auth"
	| "quota"
	| "malformed"
	| "empty"
	| "challenge"
	| "timeout"
	| "unavailable"
	| "rate-limit";

export class WebAccessError extends Error {
	constructor(readonly reason: WebAccessFailure) {
		super(`Web access failed (${reason}).`);
		this.name = "WebAccessError";
	}
}

export const MAX_PAGE_BYTES = 2_000_000;

/**
 * `serviceTimeoutMs` is what the search service itself may spend, inside the caller's own deadline. `maxResults` and
 * `maxChars` are "Results from one search" and "Text kept from one page" (Settings → AI & developer → Web access).
 */
export type ProviderRequest = {
	connection: WebAccessConnection;
	signal: AbortSignal;
	serviceTimeoutMs: number;
	maxResults: number;
	maxChars: number;
};
