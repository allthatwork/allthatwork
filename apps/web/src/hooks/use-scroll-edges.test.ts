import { describe, expect, it } from "vitest";
import { getEdgeFadeStyle, getScrollEdges } from "./use-scroll-edges";

describe("getScrollEdges", () => {
	it("has no edges when everything fits", () => {
		expect(getScrollEdges({ scrollLeft: 0, scrollWidth: 1200, clientWidth: 1200 })).toEqual({
			left: false,
			right: false,
		});
		// Subpixel leftovers don't count as more.
		expect(getScrollEdges({ scrollLeft: 0, scrollWidth: 1200.6, clientWidth: 1200 })).toEqual({
			left: false,
			right: false,
		});
	});

	it("has more on the right at the start", () => {
		expect(getScrollEdges({ scrollLeft: 0, scrollWidth: 1400, clientWidth: 1000 })).toEqual({
			left: false,
			right: true,
		});
	});

	it("has more on both sides in the middle", () => {
		expect(getScrollEdges({ scrollLeft: 200, scrollWidth: 1400, clientWidth: 1000 })).toEqual({
			left: true,
			right: true,
		});
	});

	it("has more on the left at the end", () => {
		expect(getScrollEdges({ scrollLeft: 400, scrollWidth: 1400, clientWidth: 1000 })).toEqual({
			left: true,
			right: false,
		});
		expect(getScrollEdges({ scrollLeft: 399.5, scrollWidth: 1400, clientWidth: 1000 })).toEqual({
			left: true,
			right: false,
		});
	});

	it("reads RTL scroll positions, which run from 0 down to minus the overflow", () => {
		expect(getScrollEdges({ scrollLeft: 0, scrollWidth: 1400, clientWidth: 1000, rtl: true })).toEqual({
			left: true,
			right: false,
		});
		expect(getScrollEdges({ scrollLeft: -400, scrollWidth: 1400, clientWidth: 1000, rtl: true })).toEqual({
			left: false,
			right: true,
		});
	});
});

describe("getEdgeFadeStyle", () => {
	it("masks nothing when there's nothing past either edge", () => {
		expect(getEdgeFadeStyle({ left: false, right: false })).toBeUndefined();
	});

	it("fades only the sides with more", () => {
		expect(getEdgeFadeStyle({ left: false, right: true })?.maskImage).toBe(
			"linear-gradient(to right, #000, #000 calc(100% - 48px), transparent)",
		);
		expect(getEdgeFadeStyle({ left: true, right: false })?.maskImage).toBe(
			"linear-gradient(to right, transparent, #000 48px, #000)",
		);
		expect(getEdgeFadeStyle({ left: true, right: true })?.maskImage).toBe(
			"linear-gradient(to right, transparent, #000 48px, #000 calc(100% - 48px), transparent)",
		);
	});
});
