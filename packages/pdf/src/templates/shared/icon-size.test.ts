import { describe, expect, it } from "vite-plus/test";
import { resolveIconSize } from "./icon-size";

describe("resolveIconSize", () => {
	it("falls back to custom style font sizes when size is omitted", () => {
		expect(
			resolveIconSize({
				styles: [{ fontSize: 10 }, { fontSize: 18 }],
			}),
		).toBe(18);
	});
});
