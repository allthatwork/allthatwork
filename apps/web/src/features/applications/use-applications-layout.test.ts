import { describe, expect, it } from "vitest";
import { changeLayout, resizeColumnChange } from "./use-applications-layout";

describe("resizeColumnChange", () => {
	it("sets the width in the account's list when it shows the column", () => {
		const layout = { listColumns: [{ id: "next" as const }, { id: "fit" as const, width: 60 }] };
		expect(changeLayout(layout, resizeColumnChange(layout, "next", 240))).toEqual({
			listColumns: [
				{ id: "next", width: 240 },
				{ id: "fit", width: 60 },
			],
		});
		expect(changeLayout(layout, resizeColumnChange(layout, "fit", null))).toEqual({
			listColumns: [{ id: "next" }, { id: "fit" }],
		});
	});

	it("uses the default list when the account hasn't picked columns", () => {
		expect(changeLayout({}, resizeColumnChange({}, "stage", 120)).listColumns).toContainEqual({
			id: "stage",
			width: 120,
		});
	});

	it("keeps the width beside the list for a column only a view shows", () => {
		const layout = { listColumns: [{ id: "next" as const }] };
		const wider = changeLayout(layout, resizeColumnChange(layout, "lane", 300));
		expect(wider).toEqual({ listColumns: [{ id: "next" }], columnWidths: { lane: 300 } });
		expect(changeLayout(wider, resizeColumnChange(wider, "lane", null))).toEqual({ listColumns: [{ id: "next" }] });
	});

	it("drops a kept width once the list sets its own", () => {
		const layout = { listColumns: [{ id: "lane" as const }], columnWidths: { lane: 300 } };
		expect(changeLayout(layout, resizeColumnChange(layout, "lane", 250))).toEqual({
			listColumns: [{ id: "lane", width: 250 }],
		});
	});
});
