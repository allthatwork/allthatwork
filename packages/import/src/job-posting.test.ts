import { describe, expect, it } from "vite-plus/test";
import { postingDeadline } from "./job-posting";

describe("postingDeadline", () => {
	it("reads a bare date as the end of that day in UTC", () => {
		expect(postingDeadline("2026-12-01")?.toISOString()).toBe("2026-12-01T23:59:59.000Z");
	});

	it("keeps a full date and time as given", () => {
		expect(postingDeadline("2026-12-01T17:00:00Z")?.toISOString()).toBe("2026-12-01T17:00:00.000Z");
		expect(postingDeadline(" 2026-12-01T17:00:00+02:00 ")?.toISOString()).toBe("2026-12-01T15:00:00.000Z");
	});

	it("drops junk and impossible days", () => {
		expect(postingDeadline("ASAP")).toBeNull();
		expect(postingDeadline("2026")).toBeNull();
		expect(postingDeadline("December 1, 2026")).toBeNull();
		expect(postingDeadline("2026-02-31")).toBeNull();
		expect(postingDeadline("2026-12-01Tnope")).toBeNull();
	});

	it("treats empty as no deadline", () => {
		expect(postingDeadline("")).toBeNull();
		expect(postingDeadline("   ")).toBeNull();
		expect(postingDeadline(null)).toBeNull();
		expect(postingDeadline(undefined)).toBeNull();
	});
});
