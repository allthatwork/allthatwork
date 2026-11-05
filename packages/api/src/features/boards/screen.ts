import type { BoardPay } from "@reactive-resume/schema/boards";
import type { CareerProfileData } from "@reactive-resume/schema/career";
import { matchOpportunity } from "../career/matching";

export type ScreenPreferences = Pick<
	CareerProfileData,
	"targetRoles" | "excludeTitles" | "locations" | "minBase" | "maxOfficeDays"
>;

export type ScreenedPosting = {
	title: string;
	location: string;
	remote: boolean;
	workplace: string | null;
	pay: BoardPay[];
	description: string;
};

/** "Leave out titles with": a phrase leaves a title out when every one of its words is in it. */
export const hasExcludedWord = (title: string, excludeTitles: string[]) =>
	matchOpportunity(title, excludeTitles).matches.length > 0;

/**
 * The checks a board's list can answer: the title matches a target role and has no left-out word, and the place
 * matches one of Preferences' locations (a remote posting counts as "Remote"). No target roles means nothing passes,
 * so a board with hundreds of roles can't flood New roles.
 */
export function passesTitleAndPlace(posting: ScreenedPosting, preferences: ScreenPreferences) {
	if (matchOpportunity(posting.title, preferences.targetRoles).matches.length === 0) return false;
	if (hasExcludedWord(posting.title, preferences.excludeTitles)) return false;
	if (!preferences.locations.length) return true;
	const place = [posting.location, posting.remote ? "Remote" : ""].join(" ");
	return matchOpportunity(place, preferences.locations).matches.length > 0;
}

const YEARLY = { hour: 2080, month: 12, year: 1 } as const;

/**
 * Whether posted pay can reach the minimum base: the top of some range in the same currency, both made yearly, is at
 * least it. Pay the board doesn't post, or posts only in other currencies, can't rule a role out.
 */
export function payReaches(pay: BoardPay[], minBase: ScreenPreferences["minBase"]) {
	if (minBase.amount === null || minBase.amount <= 0) return true;
	const comparable = pay.filter((range) => range.currency === minBase.currency && (range.max ?? range.min) !== null);
	if (!comparable.length) return true;
	const floor = minBase.amount * YEARLY[minBase.period];
	return comparable.some((range) => (range.max ?? range.min ?? 0) * YEARLY[range.period] >= floor);
}

const WORD_DAYS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const DAYS = String.raw`([1-5]|one|two|three|four|five)`;
const OFFICE_DAYS = [
	new RegExp(
		String.raw`\b${DAYS}\s*(?:days?|x)\s*(?:a|per|each|/)\s*week\s*(?:in|at|from)\s*(?:the|our|an?)?\s*(?:office|on-?site)`,
		"i",
	),
	new RegExp(String.raw`\b${DAYS}\s*(?:days?|x)\s*(?:a|per|each|/)\s*week\s*(?:in-office|on-?site)`, "i"),
	new RegExp(String.raw`\b(?:in[- ]office|on-?site|in the office)\s*${DAYS}\s*days?`, "i"),
	new RegExp(String.raw`\b${DAYS}\s*(?:office|in-office|on-?site)\s*days?`, "i"),
];

/**
 * How many office days a week the posting states: a number in its text ("3 days a week in the office"), else what its
 * workplace says (on-site is 5, hybrid at least 1, remote 0). Null when it says nothing.
 */
export function officeDaysStated(posting: Pick<ScreenedPosting, "workplace" | "description" | "location">) {
	for (const pattern of OFFICE_DAYS) {
		const found = pattern.exec(posting.description)?.[1]?.toLowerCase();
		if (found) return WORD_DAYS[found] ?? Number(found);
	}
	if (posting.workplace === "onsite") return 5;
	if (posting.workplace === "hybrid" || /\bhybrid\b/i.test(posting.location)) return 1;
	if (posting.workplace === "remote") return 0;
	return null;
}

/** The checks that need pay and full text: pay can reach the minimum, and stated office days aren't over the maximum. */
export function passesPayAndOffice(posting: ScreenedPosting, preferences: ScreenPreferences) {
	if (!payReaches(posting.pay, preferences.minBase)) return false;
	if (preferences.maxOfficeDays === null) return true;
	const stated = officeDaysStated(posting);
	return stated === null || stated <= preferences.maxOfficeDays;
}

export const passesScreen = (posting: ScreenedPosting, preferences: ScreenPreferences) =>
	passesTitleAndPlace(posting, preferences) && passesPayAndOffice(posting, preferences);
