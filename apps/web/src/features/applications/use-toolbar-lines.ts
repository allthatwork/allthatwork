import { useLayoutEffect, useRef, useState } from "react";
import { toolbarFitsOneLine } from "./toolbar-lines";

const widthOf = (element: Element | null) => (element ? element.getBoundingClientRect().width : 0);

/**
 * Whether the toolbar takes two lines, measured: whenever the toolbar, the filter group or Sort and Columns change size,
 * or a filter button's text changes (a filter set or cleared), it checks whether everything still fits on one line.
 * `active` false (phones, Insights) keeps one line. `watch` changes when Sort and Columns come or go, so they get
 * observed.
 */
export function useToolbarLines(active: boolean, watch: string) {
	const toolbarRef = useRef<HTMLDivElement>(null);
	const filtersRef = useRef<HTMLDivElement>(null);
	const endRef = useRef<HTMLDivElement>(null);
	const [oneLine, setOneLine] = useState(true);

	useLayoutEffect(() => {
		if (!active) return;
		const measure = () => {
			const toolbar = toolbarRef.current;
			const filters = filtersRef.current;
			if (!toolbar || !filters) return;
			setOneLine(
				toolbarFitsOneLine({
					toolbar: toolbar.clientWidth,
					filters: [...filters.children].map(widthOf),
					end: widthOf(endRef.current),
				}),
			);
		};
		// The observer reports each element once when it starts watching, which takes the first measure.
		const resize = new ResizeObserver(measure);
		for (const element of [toolbarRef.current, filtersRef.current, endRef.current])
			if (element) resize.observe(element);
		// A button's text can change without the group's box changing (on its own line, with room to spare).
		const mutation = new MutationObserver(measure);
		if (filtersRef.current) {
			mutation.observe(filtersRef.current, { childList: true, subtree: true, characterData: true });
		}
		return () => {
			resize.disconnect();
			mutation.disconnect();
		};
	}, [active, watch]);

	return { twoLines: active && !oneLine, toolbarRef, filtersRef, endRef };
}
