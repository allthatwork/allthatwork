import type { CSSProperties, RefObject } from "react";
import { useLayoutEffect, useState } from "react";

/** Which sides of a sideways scroller have content past the edge. Physical sides, so the fade is right in RTL too. */
export type ScrollEdges = { left: boolean; right: boolean };

type ScrollMetrics = { scrollLeft: number; scrollWidth: number; clientWidth: number; rtl?: boolean };

// Subpixel layouts leave a fraction of a pixel of "overflow" when everything fits.
const TOLERANCE = 1;

export function getScrollEdges({ scrollLeft, scrollWidth, clientWidth, rtl = false }: ScrollMetrics): ScrollEdges {
	const max = Math.max(0, scrollWidth - clientWidth);
	if (max <= TOLERANCE) return { left: false, right: false };
	// In RTL, scrollLeft runs from 0 (start, on the right) down to -max.
	const fromLeft = rtl ? scrollLeft + max : scrollLeft;
	return { left: fromLeft > TOLERANCE, right: max - fromLeft > TOLERANCE };
}

const FADE = "48px";

/** A CSS mask that fades the sides with more content, or nothing when everything fits. */
export function getEdgeFadeStyle({ left, right }: ScrollEdges): CSSProperties | undefined {
	if (!left && !right) return undefined;
	const start = left ? `transparent, #000 ${FADE}` : "#000";
	const end = right ? `#000 calc(100% - ${FADE}), transparent` : "#000";
	const mask = `linear-gradient(to right, ${start}, ${end})`;
	return { maskImage: mask, WebkitMaskImage: mask };
}

/**
 * Tracks which edges of a sideways scroller hide content: on scroll, on resize, and whenever `contentKey` changes
 * (pass something that changes when items are added or removed).
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>, contentKey?: unknown): ScrollEdges {
	const [edges, setEdges] = useState<ScrollEdges>({ left: false, right: false });

	// oxlint-disable-next-line react/exhaustive-deps -- contentKey only triggers a re-measure
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;

		const update = () => {
			const next = getScrollEdges({
				scrollLeft: element.scrollLeft,
				scrollWidth: element.scrollWidth,
				clientWidth: element.clientWidth,
				rtl: getComputedStyle(element).direction === "rtl",
			});
			setEdges((current) => (current.left === next.left && current.right === next.right ? current : next));
		};

		update();
		element.addEventListener("scroll", update, { passive: true });
		const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
		observer?.observe(element);
		return () => {
			element.removeEventListener("scroll", update);
			observer?.disconnect();
		};
	}, [ref, contentKey]);

	return edges;
}
