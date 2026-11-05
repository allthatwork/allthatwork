import { describe, expect, it } from "vitest";
import { careerProfileDataSchema } from "@reactive-resume/schema/career";
import { hasExcludedWord, officeDaysStated, passesScreen, passesTitleAndPlace, payReaches } from "./screen";

const preferences = careerProfileDataSchema.parse({
	targetRoles: ["Site Reliability Engineer", "Platform engineer"],
	excludeTitles: ["Intern", "Sales"],
	locations: ["Berlin", "Remote"],
	minBase: { amount: 90_000, currency: "EUR", period: "year" },
	maxOfficeDays: 2,
});
const posting = {
	title: "Senior Platform Engineer",
	location: "Berlin, Germany",
	remote: false,
	workplace: null,
	pay: [],
	description: "",
};

describe("passesTitleAndPlace", () => {
	it("needs a target role in the title and no left-out word", () => {
		expect(passesTitleAndPlace(posting, preferences)).toBe(true);
		expect(passesTitleAndPlace({ ...posting, title: "Product Designer" }, preferences)).toBe(false);
		expect(passesTitleAndPlace({ ...posting, title: "Platform Engineer Intern" }, preferences)).toBe(false);
	});

	it("passes nothing without target roles", () => {
		expect(passesTitleAndPlace(posting, { ...preferences, targetRoles: [] })).toBe(false);
	});

	it("matches the place against locations, counting a remote posting as Remote", () => {
		expect(passesTitleAndPlace({ ...posting, location: "London" }, preferences)).toBe(false);
		expect(passesTitleAndPlace({ ...posting, location: "Europe", remote: true }, preferences)).toBe(true);
		expect(
			passesTitleAndPlace({ ...posting, location: "Europe", remote: true }, { ...preferences, locations: ["Berlin"] }),
		).toBe(false);
		expect(passesTitleAndPlace({ ...posting, location: "Anywhere" }, { ...preferences, locations: [] })).toBe(true);
	});
});

describe("payReaches", () => {
	const min = preferences.minBase;
	it("compares the top of a range in the same currency, made yearly", () => {
		expect(payReaches([{ min: 70_000, max: 95_000, currency: "EUR", period: "year" }], min)).toBe(true);
		expect(payReaches([{ min: 60_000, max: 80_000, currency: "EUR", period: "year" }], min)).toBe(false);
		expect(payReaches([{ min: 7000, max: 8000, currency: "EUR", period: "month" }], min)).toBe(true);
		expect(payReaches([{ min: 30, max: 40, currency: "EUR", period: "hour" }], min)).toBe(false);
		expect(payReaches([{ min: 80_000, max: null, currency: "EUR", period: "year" }], min)).toBe(false);
	});

	it("can't rule a role out on pay it doesn't post, or posts in another currency", () => {
		expect(payReaches([], min)).toBe(true);
		expect(payReaches([{ min: 10, max: 20, currency: "USD", period: "year" }], min)).toBe(true);
		expect(payReaches([{ min: 10, max: 20, currency: "EUR", period: "year" }], { ...min, amount: null })).toBe(true);
	});
});

describe("officeDaysStated", () => {
	const at = (description: string, workplace: string | null = null) => ({ description, workplace, location: "" });
	it("reads a number from the text before the workplace", () => {
		expect(officeDaysStated(at("We work 3 days a week in the office."))).toBe(3);
		expect(officeDaysStated(at("Expect four days per week on-site.", "hybrid"))).toBe(4);
		expect(officeDaysStated(at("In-office 2 days, remote otherwise."))).toBe(2);
		expect(officeDaysStated(at("2 office days a week"))).toBe(2);
	});

	it("falls back to on-site, hybrid and remote, and says nothing otherwise", () => {
		expect(officeDaysStated(at("", "onsite"))).toBe(5);
		expect(officeDaysStated(at("", "hybrid"))).toBe(1);
		expect(officeDaysStated({ description: "", workplace: null, location: "Berlin (Hybrid)" })).toBe(1);
		expect(officeDaysStated(at("", "remote"))).toBe(0);
		expect(officeDaysStated(at("A great team."))).toBeNull();
	});
});

describe("passesScreen", () => {
	it("hides a role only when its office days are stated and over the maximum", () => {
		expect(passesScreen({ ...posting, workplace: "onsite" }, preferences)).toBe(false);
		expect(passesScreen({ ...posting, workplace: "hybrid" }, preferences)).toBe(true);
		expect(passesScreen(posting, { ...preferences, maxOfficeDays: 0 })).toBe(true);
		expect(passesScreen({ ...posting, workplace: "onsite" }, { ...preferences, maxOfficeDays: null })).toBe(true);
	});

	it("hides a role whose posted pay can't reach the minimum", () => {
		expect(
			passesScreen({ ...posting, pay: [{ min: 50_000, max: 60_000, currency: "EUR", period: "year" }] }, preferences),
		).toBe(false);
	});
});

describe("hasExcludedWord", () => {
	it("needs every word of a left-out phrase, plurals included", () => {
		expect(hasExcludedWord("Sales Engineer", ["Sales"])).toBe(true);
		expect(hasExcludedWord("Engineering Manager", ["Sales"])).toBe(false);
		expect(hasExcludedWord("Account Executives", ["account executive"])).toBe(true);
		expect(hasExcludedWord("Executive Assistant", ["account executive"])).toBe(false);
	});
});
