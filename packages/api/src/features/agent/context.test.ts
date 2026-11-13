import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { estimateTokens, pruneAgentModelContext, replyContextBudget } from "./context";

const BIG_RESUME = { basics: { name: "Alice" }, sections: { summary: { content: "x".repeat(2_000) } } };

function readResumeExchange(callId: string, toolName = "read_resume"): ModelMessage[] {
	return [
		{
			role: "assistant",
			content: [{ type: "tool-call", toolCallId: callId, toolName, input: {} }],
		},
		{
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: callId,
					toolName,
					output: { type: "json", value: { id: "resume-1", data: BIG_RESUME } },
				},
			],
		},
	] as ModelMessage[];
}

function patchExchange(callId: string): ModelMessage[] {
	return [
		{
			role: "assistant",
			content: [{ type: "tool-call", toolCallId: callId, toolName: "apply_resume_patch", input: { title: "Edit" } }],
		},
		{
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: callId,
					toolName: "apply_resume_patch",
					output: { type: "json", value: { actionId: `action-${callId}`, resume: BIG_RESUME } },
				},
			],
		},
	] as ModelMessage[];
}

function user(text: string): ModelMessage {
	return { role: "user", content: [{ type: "text", text }] };
}

function messageParts(message: ModelMessage | undefined) {
	return (message?.content ?? []) as Array<Record<string, unknown>>;
}

function snapshotValue(message: ModelMessage | undefined) {
	const part = messageParts(message)[0];
	return ((part?.output ?? {}) as { value?: Record<string, unknown> }).value ?? {};
}

describe("pruneAgentModelContext — tier 0 (snapshot supersession)", () => {
	it("keeps only the last cover letter snapshot too", () => {
		const messages = [
			user("hi"),
			...readResumeExchange("call-1", "read_letter"),
			...readResumeExchange("call-2", "read_letter"),
		];

		const pruned = pruneAgentModelContext(messages, 1_000_000);

		expect(snapshotValue(pruned[2])).not.toHaveProperty("data");
		expect(snapshotValue(pruned[4])).toHaveProperty("data");
	});
});

describe("pruneAgentModelContext — tier 3 (turn dropping)", () => {
	function textTurn(userText: string, assistantText: string): ModelMessage[] {
		return [
			{ role: "user", content: [{ type: "text", text: userText }] },
			{ role: "assistant", content: [{ type: "text", text: assistantText }] },
		];
	}

	it("drops tool call/result pairs atomically with their turn", () => {
		const messages = [
			...textTurn("intro ".repeat(60), "ok"),
			{ role: "user", content: [{ type: "text", text: "edit please ".repeat(60) }] } as ModelMessage,
			...patchExchange("call-old"),
			...textTurn("follow up ".repeat(30), "done"),
			...textTurn("latest question", "latest answer"),
		];

		const pruned = pruneAgentModelContext(messages, 40);

		// The dropped turn takes both the tool call and its result with it — no orphaned side.
		const text = JSON.stringify(pruned);
		expect(text).not.toContain("call-old");
		expect(text).not.toContain('"tool-result"');
		expect(text).toContain("latest question");
	});

	it("never drops the final two turns even when still over budget", () => {
		const messages = [
			...textTurn("first question ".repeat(100), "first answer ".repeat(100)),
			...textTurn("second question ".repeat(100), "second answer ".repeat(100)),
			...textTurn("third question ".repeat(100), "third answer ".repeat(100)),
		];

		const pruned = pruneAgentModelContext(messages, 10);

		// Only the oldest turn is droppable; the penultimate and final turns must both survive
		// even though the result is still over budget.
		expect(pruned).toHaveLength(4);
		expect(JSON.stringify(pruned)).not.toContain("first question");
		expect(JSON.stringify(pruned)).toContain("second question");
		expect(JSON.stringify(pruned)).toContain("third question");
	});
});

describe("estimateTokens", () => {
	it("counts an image at a flat 1,500 tokens, whatever its size", () => {
		const bytes = new Uint8Array(3 * 1024 * 1024);
		const image = { role: "user", content: [{ type: "image", image: bytes, mediaType: "image/png" }] };
		const asFile = { type: "file", data: bytes, mediaType: "image/jpeg" };

		// The message adds a few tokens of structure around the part.
		expect(estimateTokens(image)).toBeGreaterThanOrEqual(1500);
		expect(estimateTokens(image)).toBeLessThan(1520);
		expect(estimateTokens(asFile)).toBe(1500);
	});

	it("counts a PDF or audio file at bytes / 4, never more than 30,000", () => {
		const small = { type: "file", data: new Uint8Array(40_000), mediaType: "application/pdf" };
		const big = { type: "file", data: new Uint8Array(1024 * 1024), mediaType: "application/pdf" };
		const audio = { type: "file", data: new Uint8Array(5 * 1024 * 1024), mediaType: "audio/mpeg" };
		// Base64 text counts its decoded bytes, without expanding it through the text tokenizer.
		const base64 = { type: "file", data: "A".repeat(40_000), mediaType: "application/pdf" };

		expect(estimateTokens(small)).toBe(10_000);
		expect(estimateTokens(big)).toBe(30_000);
		expect(estimateTokens(audio)).toBe(30_000);
		expect(estimateTokens(base64)).toBe(7500);
	});

	it("counts an object that only looks like a part by its fields, not as an attachment", () => {
		const record = { type: "file", filename: "notes.pdf", summary: "x".repeat(4000) };

		expect(estimateTokens(record)).toBeGreaterThan(100);
	});

	it("keeps earlier tool results when a screenshot is attached", () => {
		const screenshot: ModelMessage = {
			role: "user",
			content: [
				{ type: "text", text: "Here is the posting." },
				{ type: "image", image: new Uint8Array(3 * 1024 * 1024), mediaType: "image/png" },
			],
		};
		const messages = [user("first question"), ...readResumeExchange("call-1"), screenshot];

		const pruned = pruneAgentModelContext(messages, 40_000);

		expect(JSON.stringify(snapshotValue(pruned[2]))).toContain("Alice");
		expect(JSON.stringify(pruned)).not.toContain("pruned to fit");
	});
});

describe("replyContextBudget", () => {
	it("uses the number set, whatever the window", () => {
		expect(replyContextBudget(150_000, 200_000)).toBe(150_000);
		expect(replyContextBudget(10_000, null)).toBe(10_000);
	});

	it("fits a blank setting to half the window, never under 40,000", () => {
		expect(replyContextBudget(null, 200_000)).toBe(100_000);
		expect(replyContextBudget(null, 32_000)).toBe(40_000);
	});

	it("keeps 40,000 when the window isn't known", () => {
		expect(replyContextBudget(null, null)).toBe(40_000);
		expect(replyContextBudget(null, undefined)).toBe(40_000);
	});
});
