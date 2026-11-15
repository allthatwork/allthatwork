import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it, vi } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));

const { targetPages } = await import("./fit");
const { measureOverflow } = await import("@reactive-resume/pdf/page-map");

const withPages = (count: number): ResumeData => ({
	...defaultResumeData,
	metadata: {
		...defaultResumeData.metadata,
		layout: {
			...defaultResumeData.metadata.layout,
			pages: Array.from({ length: count }, () => ({ fullWidth: false, main: [], sidebar: [] })),
		},
	},
});

// Every node here belongs to authored page 1, as the renderer keys it.
const node = (page: number, y: number, height: number) => ({
	key: "page-1/region-main/section-experience",
	page,
	y,
	height,
});
const rendered = (pageCount: number, nodes: Array<ReturnType<typeof node>>) =>
	({ pageCount, pageMap: { pages: [], nodes } }) as unknown as Parameters<typeof measureOverflow>[1];

describe("Resume length", () => {
	it("targets the account's length unless the layout has more pages", () => {
		expect(targetPages(withPages(1), 1)).toBe(1);
		expect(targetPages(withPages(1), 2)).toBe(2);
		expect(targetPages(withPages(3), 2)).toBe(3);
	});

	it("doesn't flag a second page when the account allows two", () => {
		const twoPages = rendered(2, [node(0, 40, 600), node(1, 40, 300)]);
		expect(measureOverflow(withPages(1), twoPages, 1)).toMatchObject({ authored: 1, target: 1, pageCount: 2 });
		expect(measureOverflow(withPages(1), twoPages, 2)).toBeNull();
	});

	it("measures only the content past the target", () => {
		const { fontSize, lineHeight } = defaultResumeData.metadata.typography.body;
		const line = fontSize * lineHeight;
		const threePages = rendered(3, [node(0, 40, 600), node(1, 40, 600), node(2, 40, line * 4)]);
		expect(measureOverflow(withPages(1), threePages, 2)).toEqual({
			authored: 1,
			target: 2,
			pageCount: 3,
			spills: [{ authoredPage: 1, pages: [3], lines: 4 }],
		});
	});
});
