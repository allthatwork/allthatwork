import { smoothStream } from "ai";

/**
 * How long a reply waits between words as it streams. The SDK's default is 10 ms, which on a full 8,192-token step
 * (about 6,500 words) spends over a minute of the reply time limit on pacing alone (pacing.test.ts measures it);
 * 2 ms still reads smoothly and spends about 13 seconds.
 */
export const REPLY_WORD_DELAY_MS = 2;

/** The stream transform the Coach and the Assistant reply through. */
export function replyPacing() {
	return smoothStream({ chunking: "word", delayInMs: REPLY_WORD_DELAY_MS });
}
