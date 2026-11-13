import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("./generate-json", () => ({ generateJson: mocks.generate }));
vi.mock("./service", () => ({ getModel: () => ({}) }));

const { contextAround, improveInputSchema, improveLine, improveOutputSchema } = await import("./improve");

describe("improve", () => {
	it("flattens the line and treats an unclear addsFacts as needing a check", () => {
		expect(improveOutputSchema.parse({ text: " Launched\nthe app ", why: "Ownership.", addsFacts: "maybe" })).toEqual({
			text: "Launched the app",
			why: "Ownership.",
			addsFacts: true,
		});
		expect(() => improveOutputSchema.parse({ text: "  " })).toThrow();
	});
});

/** A field of numbered paragraphs, about `chars` long, with `line` in the middle. */
const fieldWith = (line: string, chars: number) => {
	const half = Array.from(
		{ length: Math.ceil(chars / 2 / 40) },
		(_, index) => `Paragraph ${index} about the work done.`,
	);
	return [...half, line, ...half.map((text) => `${text} Later.`)].join("\n");
};

describe("improve on long text", () => {
	beforeEach(() => {
		mocks.generate.mockReset().mockResolvedValue({ text: "Better.", why: "", addsFacts: false });
	});

	it("accepts a 5,000-character line in a 50,000-character field", () => {
		const line = `${"Led the migration. ".repeat(300).slice(0, 4999)}.`;
		expect(line).toHaveLength(5000);
		const context = fieldWith(line, 50_000);
		expect(context.length).toBeGreaterThan(50_000);
		expect(improveInputSchema.safeParse({ action: "shorter", line, context }).success).toBe(true);
		expect(improveInputSchema.safeParse({ action: "shorter", line: "x".repeat(10_001) }).success).toBe(false);
		expect(improveInputSchema.safeParse({ action: "shorter", line: "x", context: "x".repeat(200_001) }).success).toBe(
			false,
		);
	});

	it("sends the model at most 10,000 characters of the field, around the line", async () => {
		const line = "Led the migration of the billing system to the new platform. ".repeat(80).trim();
		const context = fieldWith(line, 50_000);
		await improveLine({
			...improveInputSchema.parse({ action: "shorter", line, context }),
			provider: "openai",
			model: "m",
			apiKey: "k",
			baseURL: "",
		});
		const prompt = String(mocks.generate.mock.lastCall?.[1]?.prompt);
		const sent = contextAround(context, line);
		expect(sent.length).toBeLessThanOrEqual(10_000);
		expect(sent).toContain(line);
		expect(sent).toContain("Paragraph");
		// Whole paragraphs at the edges.
		expect(sent.startsWith("Paragraph")).toBe(true);
		expect(sent.endsWith("Later.")).toBe(true);
		expect(prompt).toContain(sent);
		expect(prompt).not.toContain(context);
	});

	it("keeps a short field whole, and the start of a field that no longer has the line", () => {
		expect(contextAround("One\nTwo", "Two")).toBe("One\nTwo");
		const context = fieldWith("Something", 50_000);
		expect(contextAround(context, "Not in the field")).toBe(context.slice(0, context.lastIndexOf("\n", 9999)));
	});

	it("keeps a line at the very end of a long field", () => {
		const line = "The last line.";
		const context = `${"Earlier paragraph.\n".repeat(3000)}${line}`;
		const sent = contextAround(context, line);
		expect(sent.length).toBeLessThanOrEqual(10_000);
		expect(sent.endsWith(line)).toBe(true);
	});
});
