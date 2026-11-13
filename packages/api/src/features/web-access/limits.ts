import { eq } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import { careerProfile } from "@reactive-resume/db/schema";
import { aiLimitsSchema } from "@reactive-resume/schema/career";

/**
 * The account's web access limits (Settings → AI & developer → Web access): the time for one web call, the text kept
 * from one page and the results kept from one search. Scheduled runs read the limits of the account they run for. Read
 * here, not through the career service, which itself depends on web access.
 */
export async function webLimits(userId: string) {
	const [row] = await db
		.select({ aiLimits: careerProfile.aiLimits })
		.from(careerProfile)
		.where(eq(careerProfile.userId, userId));
	const limits = aiLimitsSchema.parse(row?.aiLimits ?? {});
	return {
		timeoutMs: limits.webCallTimeoutSeconds * 1000,
		pageChars: limits.webPageChars,
		searchResults: limits.webSearchResults,
	};
}
