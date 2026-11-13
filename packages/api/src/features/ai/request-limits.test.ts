import { describe, expect, it } from "vitest";
import { aiLimitsSchema } from "@reactive-resume/schema/career";
import { modelCallOptions, sdkCallSettings, withRequestLimits } from "./request-limits";

// Under the setting's 30-second minimum, so the test doesn't wait; the code takes any number.
const limits = { ...aiLimitsSchema.parse({}), requestTimeoutSeconds: 0.05 };
const untilAborted = (signal: AbortSignal) =>
	new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));

describe("All AI requests limits", () => {
	it("stops a request at the time limit with a message naming the setting", async () => {
		await expect(withRequestLimits(limits, ({ signal }) => untilAborted(signal))).rejects.toMatchObject({
			code: "GATEWAY_TIMEOUT",
			message: expect.stringContaining('Raise "Time limit for other AI requests"'),
		});
	});

	it("lets a cancelled request end as a cancellation, not a time-limit message", async () => {
		const controller = new AbortController();
		const pending = withRequestLimits(
			{ ...limits, requestTimeoutSeconds: 60 },
			({ signal }) => untilAborted(signal),
			controller.signal,
		);
		controller.abort(new DOMException("Stopped", "AbortError"));
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	});

	it("passes the user's retries and structured answer length, and leaves out a blank length", async () => {
		let seen: unknown;
		await withRequestLimits({ ...limits, modelRetries: 4, jsonOutputTokens: 4096 }, async (options) => {
			seen = sdkCallSettings(options);
		});
		expect(seen).toMatchObject({ maxRetries: 4, maxOutputTokens: 4096, abortSignal: expect.any(AbortSignal) });
		expect(sdkCallSettings(modelCallOptions(aiLimitsSchema.parse({})))).toEqual({ maxRetries: 2 });
	});
});
