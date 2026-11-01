import type { Application } from "./types";
import { FOUND_BY_IN_APP_SEARCH } from "@reactive-resume/schema/applications/data";

// Starting points for the pick lists; the values already in use come first.
export const FOUND_ON_PRESETS = ["Greenhouse", "Ashby", "Lever", "LinkedIn", "Indeed", "Company website", "Other"];
export const FOUND_BY_PRESETS = ["Me", "Referral", "Recruiter", FOUND_BY_IN_APP_SEARCH];

type PickValues = (application: Application) => (string | null | undefined)[];

/**
 * Suggestions for a free-text field: the values used on these applications, most used first (ties by name), then the
 * presets nobody has used yet. Values that differ only in case count as one, spelled as first seen.
 */
export function suggestValues(
	applications: Application[],
	pick: PickValues,
	presets: readonly string[] = [],
): string[] {
	const counts = new Map<string, { value: string; count: number }>();
	for (const application of applications) {
		for (const raw of pick(application)) {
			const value = raw?.trim();
			if (!value) continue;
			const key = value.toLowerCase();
			const seen = counts.get(key);
			if (seen) seen.count += 1;
			else counts.set(key, { value, count: 1 });
		}
	}
	const used = [...counts.values()]
		.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
		.map((entry) => entry.value);
	return [...used, ...presets.filter((preset) => !counts.has(preset.toLowerCase()))];
}

export const foundOnSuggestions = (applications: Application[]) =>
	suggestValues(applications, (application) => [application.source], FOUND_ON_PRESETS);

export const foundBySuggestions = (applications: Application[]) =>
	suggestValues(applications, (application) => [application.foundBy], FOUND_BY_PRESETS);

/** A fit typed by hand: a whole number from 0 to 100, with or without "%". Empty clears it; anything else is invalid. */
export function parseFit(text: string): number | null | undefined {
	const value = text.trim().replace(/%$/, "").trim();
	if (!value) return null;
	if (!/^\d{1,3}$/.test(value)) return undefined;
	const fit = Number(value);
	return fit <= 100 ? fit : undefined;
}
