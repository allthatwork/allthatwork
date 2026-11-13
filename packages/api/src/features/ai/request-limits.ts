import type { AiLimits } from "@reactive-resume/schema/career";
import { ORPCError } from "@orpc/client";

/** What every model call takes from Settings → AI limits → All AI requests. */
export type ModelCallOptions = {
	signal?: AbortSignal | undefined;
	/** Retries after a failed call; the AI SDK's own default (2) when left out. */
	maxRetries?: number | undefined;
	/** The longest answer; null or left out sends no limit, so the provider's default applies. */
	maxOutputTokens?: number | null | undefined;
};

/** The retries and, for structured answers, the answer length the user set. */
export const modelCallOptions = (limits: Pick<AiLimits, "modelRetries" | "jsonOutputTokens">): ModelCallOptions => ({
	maxRetries: limits.modelRetries,
	maxOutputTokens: limits.jsonOutputTokens,
});

/** The AI SDK call settings for these options, leaving out what isn't set. */
export const sdkCallSettings = (options: ModelCallOptions = {}) => ({
	...(options.signal ? { abortSignal: options.signal } : {}),
	...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
	...(typeof options.maxOutputTokens === "number" ? { maxOutputTokens: options.maxOutputTokens } : {}),
});

/** A request that reached "Time limit for other AI requests": not a server fault, so it names the setting. */
export const requestTimeoutError = (seconds: number) =>
	new ORPCError("GATEWAY_TIMEOUT", {
		message: `The AI didn't finish within the ${seconds}-second time limit. Raise "Time limit for other AI requests" in Settings → AI & developer → AI limits, or set a lower reasoning effort on the AI connection.`,
	});

/**
 * Runs a request that has no time limit of its own (Writing review, Improve, reading PDF and Word files, the
 * application AI, drafting letters) within "Time limit for other AI requests", with the user's retries. Reaching the
 * limit throws GATEWAY_TIMEOUT naming the setting; a cancelled request still ends as a cancellation.
 */
export async function withRequestLimits<T>(
	limits: Pick<AiLimits, "requestTimeoutSeconds" | "modelRetries" | "jsonOutputTokens">,
	run: (options: ModelCallOptions & { signal: AbortSignal }) => Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	const timeout = AbortSignal.timeout(limits.requestTimeoutSeconds * 1000);
	const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
	try {
		return await run({ ...modelCallOptions(limits), signal: combined });
	} catch (error) {
		if (timeout.aborted && !signal?.aborted) throw requestTimeoutError(limits.requestTimeoutSeconds);
		throw error;
	}
}
