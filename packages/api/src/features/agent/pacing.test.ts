import type { TextStreamPart, ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import { smoothStream } from "ai";
import { estimateTokenCount } from "tokenx";
import { REPLY_WORD_DELAY_MS } from "./pacing";

const SENTENCE =
	"The platform team moved the warehouse to a new region without downtime, and on-call pages fell by forty percent. ";

/** A reply of about this many tokens, as a model would stream it. */
function replyText(tokens: number) {
	let text = "";
	while (estimateTokenCount(text) < tokens) text += SENTENCE;
	return text;
}

/** The milliseconds smoothStream waits between words while streaming this text. */
async function pacingMs(text: string, delayInMs: number) {
	let waited = 0;
	const transform = smoothStream<ToolSet>({
		chunking: "word",
		delayInMs,
		_internal: {
			delay: async (ms) => {
				waited += ms ?? 0;
			},
		},
	})({ tools: {} });
	const writer = transform.writable.getWriter();
	const reader = transform.readable.getReader();
	const drained = (async () => {
		while (!(await reader.read()).done);
	})();
	for (let start = 0; start < text.length; start += 20) {
		await writer.write({
			type: "text-delta",
			id: "reply",
			text: text.slice(start, start + 20),
		} as TextStreamPart<ToolSet>);
	}
	await writer.close();
	await drained;
	return waited;
}

describe("reply pacing", () => {
	it("spends under a fifth of the SDK default's time on a full 8,192-token step", async () => {
		const text = replyText(8192);

		// Measured: the SDK default (10 ms a word) spends over a minute of a reply's time limit on pacing.
		expect(await pacingMs(text, 10)).toBeGreaterThan(60_000);
		expect(await pacingMs(text, REPLY_WORD_DELAY_MS)).toBeLessThan(15_000);
	});
});
