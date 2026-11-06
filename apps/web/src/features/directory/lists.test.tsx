import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { initials } from "./lists";

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
