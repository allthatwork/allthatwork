import { describe, expect, it } from "vitest";
import z from "zod";
import { cutText, tolerant } from "./tolerant";

const schema = z.object({
	title: z.string().trim().max(10),
	note: z.string().trim().max(200),
	minutes: z.number().int().min(5).max(120),
	tags: z.array(z.string().max(5)).max(3).default([]),
	ids: z.array(z.string()).max(2).catch([]),
	nested: z.object({ items: z.array(z.object({ text: z.string().max(4) })).max(1) }).nullable(),
	changes: z
		.array(
			z.discriminatedUnion("type", [
				z.object({ type: z.literal("stage"), stage: z.enum(["screening", "offer"]) }),
				z.object({ type: z.literal("follow-up"), note: z.string().max(5) }),
			]),
		)
		.max(2),
});

const valid = {
	title: "Short",
	note: "Fine.",
	minutes: 30,
	tags: ["a"],
	ids: ["f1"],
	nested: { items: [{ text: "ok" }] },
	changes: [{ type: "stage", stage: "offer" }],
};

describe("tolerant", () => {
	it("leaves output that fits as it is", () => {
		expect(tolerant(schema).parse(valid)).toEqual(valid);
	});

	it("keeps the first items of a list one over its cap, at any depth", () => {
		const parsed = tolerant(schema).parse({
			...valid,
			tags: ["a", "b", "c", "d"],
			ids: ["f1", "f2", "f3"],
			nested: { items: [{ text: "one" }, { text: "two" }] },
			changes: [
				{ type: "stage", stage: "offer" },
				{ type: "follow-up", note: "Call" },
				{ type: "stage", stage: "screening" },
			],
		});
		expect(parsed.tags).toEqual(["a", "b", "c"]);
		expect(parsed.ids).toEqual(["f1", "f2"]);
		expect(parsed.nested?.items).toEqual([{ text: "one" }]);
		expect(parsed.changes).toHaveLength(2);
		// The strict schema still refuses the same output.
		expect(schema.safeParse({ ...valid, tags: ["a", "b", "c", "d"] }).success).toBe(false);
	});

	it("cuts a long string, inside lists and union options too", () => {
		const parsed = tolerant(schema).parse({
			...valid,
			title: "  A much longer title  ",
			tags: ["abcdefgh"],
			changes: [{ type: "follow-up", note: "Call them back" }],
		});
		expect(parsed.title).toBe("A much lon");
		expect(parsed.tags).toEqual(["abcde"]);
		expect(parsed.changes).toEqual([{ type: "follow-up", note: "Call" }]);
	});

	it("clamps an out-of-range number and rounds one that must be whole", () => {
		expect(tolerant(schema).parse({ ...valid, minutes: 240 }).minutes).toBe(120);
		expect(tolerant(schema).parse({ ...valid, minutes: 1 }).minutes).toBe(5);
		expect(tolerant(schema).parse({ ...valid, minutes: 12.6 }).minutes).toBe(13);
	});

	it("still fails a wrong type, a missing field or an unknown option", () => {
		const parser = tolerant(schema);
		expect(parser.safeParse({ ...valid, title: 12 }).success).toBe(false);
		expect(parser.safeParse({ ...valid, minutes: "30" }).success).toBe(false);
		expect(parser.safeParse({ ...valid, tags: "a" }).success).toBe(false);
		const { title: _, ...missing } = valid;
		expect(parser.safeParse(missing).success).toBe(false);
		expect(parser.safeParse({ ...valid, changes: [{ type: "interview" }] }).success).toBe(false);
	});

	it("keeps defaults and catches working", () => {
		const { tags: _, ...rest } = valid;
		expect(tolerant(schema).parse({ ...rest, ids: "nope" })).toMatchObject({ tags: [], ids: [] });
	});
});

describe("cutText", () => {
	it("cuts a short cap exactly and a long one at a word", () => {
		expect(cutText("Interview prep", 9)).toBe("Interview");
		expect(cutText("Interview prep", 11)).toBe("Interview p");
		const long = `${"word ".repeat(60)}end`;
		const cut = cutText(long, 203);
		expect(cut.length).toBeLessThanOrEqual(203);
		expect(cut.endsWith("word")).toBe(true);
		expect(cutText(long, 200)).toBe("word ".repeat(40).trimEnd());
	});

	it("never splits a character pair", () => {
		expect(cutText("ab😀", 3)).toBe("ab");
	});

	it("cuts one long unbroken word where it is", () => {
		const text = `See ${"x".repeat(400)}`;
		expect(cutText(text, 300)).toHaveLength(300);
	});
});
