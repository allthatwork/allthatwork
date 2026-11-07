import { describe, expect, it } from "vitest";
import {
	applicationsLayoutSchema,
	BOARD_COLUMN_WIDTH,
	DEFAULT_LIST_COLUMNS,
	LIST_COLUMN_MAX_WIDTH,
	LIST_COLUMN_WIDTHS,
	readApplicationsLayout,
	resolveListColumns,
} from "./layout";

describe("applicationsLayoutSchema", () => {
	it("accepts a full layout", () => {
		const layout = {
			sort: { sort: "added", dir: "desc" },
			listColumns: [{ id: "next", width: 180 }, { id: "added" }],
			boardColumnWidth: 420,
		};
		expect(applicationsLayoutSchema.parse(layout)).toEqual(layout);
	});

	it("accepts an empty layout", () => {
		expect(applicationsLayoutSchema.parse({})).toEqual({});
	});

	it("rejects a column shown twice, unknown columns and widths out of range", () => {
		expect(applicationsLayoutSchema.safeParse({ listColumns: [{ id: "fit" }, { id: "fit" }] }).success).toBe(false);
		expect(applicationsLayoutSchema.safeParse({ listColumns: [{ id: "role" }] }).success).toBe(false);
		expect(applicationsLayoutSchema.safeParse({ listColumns: [{ id: "next", width: 9000 }] }).success).toBe(false);
		expect(applicationsLayoutSchema.safeParse({ boardColumnWidth: 100 }).success).toBe(false);
		expect(applicationsLayoutSchema.safeParse({ sort: { sort: "salary", dir: "asc" } }).success).toBe(false);
	});
});

describe("readApplicationsLayout", () => {
	it("returns the defaults for nothing saved or something unreadable", () => {
		expect(readApplicationsLayout(null)).toEqual({});
		expect(readApplicationsLayout(undefined)).toEqual({});
		expect(readApplicationsLayout("nope")).toEqual({});
		expect(readApplicationsLayout([1, 2])).toEqual({});
	});

	it("keeps a valid sort and drops an invalid one", () => {
		expect(readApplicationsLayout({ sort: { sort: "tfit", dir: "asc" } }).sort).toEqual({ sort: "tfit", dir: "asc" });
		expect(readApplicationsLayout({ sort: { sort: "nonsense" } }).sort).toBeUndefined();
		expect(readApplicationsLayout({ sort: "added" }).sort).toBeUndefined();
	});

	it("drops unknown and repeated columns and clamps widths", () => {
		const layout = readApplicationsLayout({
			listColumns: [
				{ id: "retired" },
				{ id: "next", width: 10 },
				{ id: "next", width: 300 },
				{ id: "lane", width: 99_999 },
				{ id: "added", width: "wide" },
				"fit",
			],
		});
		expect(layout.listColumns).toEqual([
			{ id: "next", width: LIST_COLUMN_WIDTHS.next.min },
			{ id: "lane", width: LIST_COLUMN_MAX_WIDTH },
			{ id: "added" },
		]);
	});

	it("keeps an empty column list, which means Role only", () => {
		expect(readApplicationsLayout({ listColumns: [] }).listColumns).toEqual([]);
	});

	it("clamps the Board column width and ignores a non-number", () => {
		expect(readApplicationsLayout({ boardColumnWidth: 10 }).boardColumnWidth).toBe(BOARD_COLUMN_WIDTH.min);
		expect(readApplicationsLayout({ boardColumnWidth: 333.6 }).boardColumnWidth).toBe(334);
		expect(readApplicationsLayout({ boardColumnWidth: "400" }).boardColumnWidth).toBeUndefined();
	});
});

describe("resolveListColumns", () => {
	it("fills in the default columns and widths", () => {
		expect(resolveListColumns({})).toEqual(
			DEFAULT_LIST_COLUMNS.map((id) => ({ id, width: LIST_COLUMN_WIDTHS[id].width })),
		);
	});

	it("keeps the saved order and widths", () => {
		expect(resolveListColumns({ listColumns: [{ id: "added" }, { id: "next", width: 240 }] })).toEqual([
			{ id: "added", width: LIST_COLUMN_WIDTHS.added.width },
			{ id: "next", width: 240 },
		]);
	});
});
