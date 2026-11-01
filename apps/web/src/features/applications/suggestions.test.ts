import type { Application } from "./types";
import { describe, expect, it } from "vitest";
import { foundBySuggestions, parseFit, suggestValues } from "./suggestions";

const app = (fields: Partial<Application>) => fields as Application;

describe("suggestValues", () => {
	it("puts the most used values first, then unused presets", () => {
		const applications = [app({ source: "Ashby" }), app({ source: "Greenhouse" }), app({ source: "Ashby" })];
		expect(suggestValues(applications, (a) => [a.source], ["Lever", "Ashby"])).toEqual([
			"Ashby",
			"Greenhouse",
			"Lever",
		]);
	});

	it("counts values that differ only in case or spaces as one, spelled as first seen", () => {
		const applications = [app({ foundBy: "Dorel" }), app({ foundBy: " dorel " }), app({ foundBy: "Muse" })];
		expect(suggestValues(applications, (a) => [a.foundBy])).toEqual(["Dorel", "Muse"]);
	});

	it("breaks ties by name and skips empty values", () => {
		const applications = [
			app({ source: "Lever" }),
			app({ source: "Ashby" }),
			app({ source: null }),
			app({ source: " " }),
		];
		expect(suggestValues(applications, (a) => [a.source])).toEqual(["Ashby", "Lever"]);
	});
});

describe("presets", () => {
	it("offers the found-by presets nobody has used yet", () => {
		expect(foundBySuggestions([app({ foundBy: "Referral" }), app({ foundBy: "Dorel" })])).toEqual([
			"Dorel",
			"Referral",
			"Me",
			"Recruiter",
			"In-app search",
		]);
	});
});

describe("parseFit", () => {
	it.each([
		["88", 88],
		["88%", 88],
		[" 100 % ", 100],
		["0", 0],
		["", null],
		["  ", null],
	])("reads %j as %j", (text, fit) => expect(parseFit(text)).toBe(fit));

	it.each(["101", "-1", "8.5", "0.88", "high", "1000"])("rejects %j", (text) => expect(parseFit(text)).toBeUndefined());
});
