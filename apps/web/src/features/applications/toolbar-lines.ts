/**
 * Whether the Applications toolbar fits on one line: the search box at its narrowest, the filter buttons side by side
 * and, at the end, Sort and Columns. When it doesn't, the toolbar takes two lines (search with Sort and Columns, then
 * all the filters), so the filters move as one group and nothing sits alone on a line.
 */

/** The search box's narrowest width. */
export const SEARCH_MIN_WIDTH = 220;
/** The gap between the search box, the filter group and Sort and Columns. */
export const TOOLBAR_GAP = 8;
/** The gap between the filter buttons. */
export const FILTER_GAP = 6;

export type ToolbarWidths = {
	/** The width the toolbar has. */
	toolbar: number;
	/** Each item in the filter group, at its natural width. */
	filters: readonly number[];
	/** Sort and Columns together; 0 when they don't show (Calendar). */
	end: number;
};

/** The filter group's width on one line. */
export const filterGroupWidth = (filters: readonly number[]) =>
	filters.length === 0 ? 0 : filters.reduce((sum, width) => sum + width, 0) + FILTER_GAP * (filters.length - 1);

export function toolbarFitsOneLine({ toolbar, filters, end }: ToolbarWidths): boolean {
	const group = filterGroupWidth(filters);
	const need = SEARCH_MIN_WIDTH + (group > 0 ? TOOLBAR_GAP + group : 0) + (end > 0 ? TOOLBAR_GAP + end : 0);
	// Rounded up, so a line that only fits by a fraction of a pixel counts as not fitting.
	return Math.ceil(need) <= toolbar;
}
