import type { ApplicationView } from "@reactive-resume/schema/applications/views";
import { describe, expect, it } from "vitest";
import { DEFAULT_APPLICATION_FILTERS } from "@reactive-resume/schema/applications/filters";
import { DEFAULT_APPLICATION_VIEW_FILTERS } from "@reactive-resume/schema/applications/views";
import { filtersOfView, isViewEdited, openingFor, tabLabelsFit, viewFiltersOf } from "./saved-views";

const view = (patch: Partial<ApplicationView> = {}): ApplicationView => ({
	id: "v1",
	name: "Ready to apply",
	filters: { ...DEFAULT_APPLICATION_VIEW_FILTERS, stage: ["saved"], build: ["built"] },
	layout: { sort: { sort: "fit", dir: "desc" }, listColumns: ["fit", "tfit", "lane"] },
	isDefault: false,
	position: 0,
	createdAt: new Date(),
	updatedAt: new Date(),
	...patch,
});

const screenOf = (v: ApplicationView) => ({
	filters: filtersOfView(v),
	sort: v.layout.sort,
	columns: v.layout.listColumns,
});

describe("isViewEdited", () => {
	const ready = view();

	it("is false right after picking the view, and ignores the search text", () => {
		expect(isViewEdited(ready, screenOf(ready))).toBe(false);
		expect(isViewEdited(ready, { ...screenOf(ready), filters: { ...filtersOfView(ready), q: "acme" } })).toBe(false);
	});

	it("ignores the order of a filter's values", () => {
		const both = view({ filters: { ...ready.filters, build: ["built", "build"] } });
		expect(
			isViewEdited(both, { ...screenOf(both), filters: { ...filtersOfView(both), build: ["build", "built"] } }),
		).toBe(false);
	});

	it("is true when a filter, the sort or the columns differ", () => {
		expect(isViewEdited(ready, { ...screenOf(ready), filters: { ...filtersOfView(ready), fit: "85" } })).toBe(true);
		expect(isViewEdited(ready, { ...screenOf(ready), sort: { sort: "fit", dir: "asc" } })).toBe(true);
		expect(isViewEdited(ready, { ...screenOf(ready), sort: { sort: "added", dir: "desc" } })).toBe(true);
		expect(isViewEdited(ready, { ...screenOf(ready), columns: ["tfit", "fit", "lane"] })).toBe(true);
		expect(isViewEdited(ready, { ...screenOf(ready), columns: ["fit", "tfit"] })).toBe(true);
	});

	it("counts Clear all as edited", () => {
		expect(isViewEdited(ready, { ...screenOf(ready), filters: { ...DEFAULT_APPLICATION_FILTERS } })).toBe(true);
	});
});

describe("viewFiltersOf", () => {
	it("drops the search text", () => {
		expect(viewFiltersOf({ ...DEFAULT_APPLICATION_FILTERS, q: "acme" })).not.toHaveProperty("q");
	});
});

describe("openingFor", () => {
	const stored = { search: { stage: "saved", build: "built", sort: "fit" }, viewId: "v1", viewColumns: null };

	it("brings back a tab's state when the address has no filters", () => {
		expect(openingFor({ address: {}, stored, views: undefined })).toEqual({ kind: "restore", tab: stored });
		const all = { search: {}, viewId: null, viewColumns: null };
		expect(openingFor({ address: {}, stored: all, views: [view({ isDefault: true })] })).toEqual({
			kind: "restore",
			tab: all,
		});
	});

	it("keeps the view after a reload, when the address has the tab's filters", () => {
		expect(openingFor({ address: { build: "built", stage: "saved", sort: "fit" }, stored, views: undefined })).toEqual({
			kind: "restore",
			tab: stored,
		});
	});

	it("opens a link's filters with no view", () => {
		expect(openingFor({ address: { stage: "applied" }, stored, views: [] })).toEqual({ kind: "address" });
		expect(openingFor({ address: { stage: "applied" }, stored: null, views: undefined })).toEqual({ kind: "address" });
	});

	it("opens a new tab at the default view, or All applications, once views have loaded", () => {
		expect(openingFor({ address: {}, stored: null, views: undefined })).toEqual({ kind: "wait" });
		const fallback = view({ id: "v2", isDefault: true });
		expect(openingFor({ address: {}, stored: null, views: [view(), fallback] })).toEqual({
			kind: "view",
			view: fallback,
		});
		expect(openingFor({ address: {}, stored: null, views: [view()] })).toEqual({ kind: "all" });
		// The sort alone isn't a filter.
		expect(openingFor({ address: { sort: "role" }, stored: null, views: [] })).toEqual({ kind: "all" });
	});
});

describe("tabLabelsFit", () => {
	const parts = { title: 160, tabs: 380, views: 0, actions: 150 };

	it("keeps the labels while everything fits on one line", () => {
		expect(tabLabelsFit({ ...parts, row: 160 + 20 + 380 + 12 + 150 })).toBe(true);
		expect(tabLabelsFit({ ...parts, row: 700 })).toBe(false);
	});

	it("counts the Views button at up to 200px, since a long name ends in an ellipsis", () => {
		const base = 160 + 20 + 380 + 12 + 150;
		expect(tabLabelsFit({ ...parts, views: 120, row: base + 12 + 120 })).toBe(true);
		expect(tabLabelsFit({ ...parts, views: 120, row: base + 12 + 119 })).toBe(false);
		expect(tabLabelsFit({ ...parts, views: 420, row: base + 12 + 200 })).toBe(true);
	});
});
