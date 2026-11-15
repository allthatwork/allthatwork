import { describe, expect, it } from "vite-plus/test";
import { filterGroupWidth, toolbarFitsOneLine } from "./toolbar-lines";

// Stage, Build, Found by, Lane, Fit, Dates and More filters, unset; then the same with Fit and Dates set and the count.
const UNSET = [102, 66, 88, 60, 50, 64, 98];
const SET = [102, 66, 88, 60, 140, 140, 98, 118];
const SORT_AND_COLUMNS = 210;

describe("toolbarFitsOneLine", () => {
	it("adds up the filter buttons with their gaps", () => {
		expect(filterGroupWidth([])).toBe(0);
		expect(filterGroupWidth([100])).toBe(100);
		expect(filterGroupWidth([100, 50, 30])).toBe(196);
	});

	it("fits on one line on a wide window", () => {
		expect(toolbarFitsOneLine({ toolbar: 1600, filters: SET, end: SORT_AND_COLUMNS })).toBe(true);
	});

	it("takes two lines once set filters make the buttons too wide", () => {
		const toolbar = 1200;
		expect(toolbarFitsOneLine({ toolbar, filters: UNSET, end: SORT_AND_COLUMNS })).toBe(true);
		expect(toolbarFitsOneLine({ toolbar, filters: SET, end: SORT_AND_COLUMNS })).toBe(false);
	});

	it("counts the search box at 300, the gaps, and Sort and Columns only when they show", () => {
		const filters = [500];
		// 300 + 8 + 500 + 8 + 200 = 1016
		expect(toolbarFitsOneLine({ toolbar: 1016, filters, end: 200 })).toBe(true);
		expect(toolbarFitsOneLine({ toolbar: 1015, filters, end: 200 })).toBe(false);
		// Calendar: no Sort and Columns, so 300 + 8 + 500.
		expect(toolbarFitsOneLine({ toolbar: 808, filters, end: 0 })).toBe(true);
		expect(toolbarFitsOneLine({ toolbar: 807, filters, end: 0 })).toBe(false);
	});

	it("doesn't call a fraction of a pixel short a fit", () => {
		expect(toolbarFitsOneLine({ toolbar: 1016, filters: [500.4], end: 200 })).toBe(false);
	});
});
