import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { initials, jobsLabel } from "./lists";

vi.mock("@/libs/orpc/client", () => ({}));

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});

describe("initials", () => {
	it("uses first and last name, or the first and last word of a one-part name", () => {
		expect(initials({ firstName: "Jan", lastName: "de Vries", name: "Jan de Vries" })).toBe("JD");
		expect(initials({ firstName: "Priya", lastName: "Menon, PMP", name: "Priya Menon, PMP" })).toBe("PM");
		expect(initials({ firstName: "Sam Rivera", lastName: "", name: "Sam Rivera" })).toBe("SR");
		expect(initials({ firstName: "Teodora", lastName: "", name: "Teodora" })).toBe("T");
	});
});

describe("jobsLabel", () => {
	it("names the platform and open roles for a watched company, with +N for more", () => {
		const first = { ats: "greenhouse" as const, region: "us" as const, slug: "halcyon", jobCount: 143 };
		const watching = [first, { ats: "lever" as const, region: "us" as const, slug: "halcyon-eu", jobCount: 4 }];
		expect(jobsLabel({ watching: watching.slice(0, 1), found: null })).toEqual({
			tone: "watch",
			long: "Watching on Greenhouse · 143 open",
			short: "Greenhouse · 143 open",
		});
		expect(jobsLabel({ watching, found: null })?.long).toBe("Watching on Greenhouse · 143 open +1");
		expect(jobsLabel({ watching: [{ ...first, jobCount: null }], found: null })?.long).toBe("Watching on Greenhouse");
	});
	it("asks to confirm one found from a posting link, and says nothing otherwise", () => {
		expect(jobsLabel({ watching: [], found: { ats: "ashby", region: "us", slug: "kestrel" } })).toEqual({
			tone: "found",
			long: "Found on Ashby · confirm",
			short: "Ashby · confirm",
		});
		expect(jobsLabel({ watching: [], found: null })).toBeNull();
	});
});
