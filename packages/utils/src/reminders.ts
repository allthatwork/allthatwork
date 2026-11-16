import z from "zod";

/**
 * Days at Applied without a reply before the app suggests a follow-up (Settings → Preferences → Reminders).
 * 0 turns the suggestion off.
 */
export const NO_REPLY_DAYS = { min: 0, max: 90, default: 10 } as const;

/**
 * Calendar days, today included, in which a Saved application whose posting is about to close needs the user: 3 flags
 * it from three days before its deadline until the deadline passes. Fixed for now, not a setting.
 */
export const POSTING_CLOSES_SOON_DAYS = 3;

export const noReplyDaysSchema = z.number().int().min(NO_REPLY_DAYS.min).max(NO_REPLY_DAYS.max);
