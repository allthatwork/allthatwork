import { useLayoutEffect, useRef, useState } from "react";
import { tabLabelsFit } from "./saved-views";

/** The Views button's text, whose full width counts even while it ends in "…". */
export const VIEWS_LABEL_ATTRIBUTE = "data-views-label";

/** A box's width with its truncated text at full length. */
function naturalWidth(element: HTMLElement) {
	const label = element.querySelector<HTMLElement>(`[${VIEWS_LABEL_ATTRIBUTE}]`);
	return element.offsetWidth + (label ? Math.max(0, label.scrollWidth - label.clientWidth) : 0);
}

/**
 * Whether the view tabs beside the title keep their labels. The title row is measured whenever it, the tabs or the
 * Views button change size: the tabs go icon only when the title, the tabs with labels, the Views button and the
 * actions can't share one line. `active` false (phones, no tabs) keeps the labels. `watch` changes when the Views
 * button comes or goes, so it gets observed.
 */
export function useTabLabels(active: boolean, watch: string) {
	const rowRef = useRef<HTMLElement>(null);
	const titleRef = useRef<HTMLHeadingElement>(null);
	const tabsRef = useRef<HTMLDivElement>(null);
	const viewsRef = useRef<HTMLSpanElement>(null);
	const actionsRef = useRef<HTMLDivElement>(null);
	const [fits, setFits] = useState(true);
	// The tabs' width with labels, kept from the last time they showed.
	const fullTabs = useRef(0);

	useLayoutEffect(() => {
		if (!active) return;
		const measure = () => {
			const row = rowRef.current;
			const title = titleRef.current;
			const tabs = tabsRef.current;
			const actions = actionsRef.current;
			if (!row || !title || !tabs || !actions) return;
			if (fits || fullTabs.current === 0) fullTabs.current = tabs.offsetWidth;
			setFits(
				tabLabelsFit({
					row: row.clientWidth,
					title: title.offsetWidth,
					tabs: fullTabs.current,
					views: viewsRef.current ? naturalWidth(viewsRef.current) : 0,
					actions: actions.offsetWidth,
				}),
			);
		};
		// The observer reports each element once when it starts watching, which takes the first measure.
		const observer = new ResizeObserver(measure);
		for (const element of [rowRef.current, viewsRef.current, tabsRef.current]) if (element) observer.observe(element);
		return () => observer.disconnect();
	}, [active, fits, watch]);

	return { labels: active ? fits : true, rowRef, titleRef, tabsRef, viewsRef, actionsRef };
}
