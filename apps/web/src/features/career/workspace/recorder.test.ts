// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { dictate, recordingBitrate, writeNumbersAsDigits } from "./recorder";

describe("recording length", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("asks for 64 kbps, less when a long recording would pass 2 MB", () => {
		expect(recordingBitrate(120)).toBe(64_000);
		expect(recordingBitrate(600)).toBeLessThan(26_000);
		expect((recordingBitrate(600) * 600) / 8).toBeLessThan(2 * 1024 * 1024);
	});

	it("stops dictation at the user's limit, not two minutes", () => {
		vi.useFakeTimers();
		const sessions: { stop: () => void; onend: (() => void) | null }[] = [];
		vi.stubGlobal(
			"SpeechRecognition",
			class {
				onend: (() => void) | null = null;
				onresult = null;
				onerror = null;
				start = vi.fn();
				abort = vi.fn();
				stop = vi.fn(() => this.onend?.());
				constructor() {
					sessions.push(this);
				}
			},
		);
		const onStop = vi.fn();
		dictate({ lang: "en", maxSeconds: 300, onTick: vi.fn(), onText: vi.fn(), onStop, onError: vi.fn() });
		vi.advanceTimersByTime(121_000);
		expect(onStop).not.toHaveBeenCalled();
		vi.advanceTimersByTime(180_000);
		expect(sessions[0]?.stop).toHaveBeenCalledOnce();
		expect(onStop).toHaveBeenCalledWith("", 300, true);
	});
});

describe("writeNumbersAsDigits", () => {
	it("rewrites spelled-out numbers and percentages, leaving everything else as it was", () => {
		expect(
			writeNumbersAsDigits(
				"I led a six person team. We interviewed eighteen customers. Activation went from fifty four to seventy one percent over twelve weeks.",
			),
		).toBe("I led a six person team. We interviewed 18 customers. Activation went from 54% to 71% over 12 weeks.");
		expect(writeNumbersAsDigits("Twenty-five per cent of one hundred and twenty users")).toBe("25% of 120 users");
		expect(writeNumbersAsDigits("No one said nineteen ninety, someone said two thousand twenty six.")).toBe(
			"No one said nineteen ninety, someone said 2026.",
		);
	});
});
