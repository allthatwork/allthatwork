import type { DbOrTx } from "@reactive-resume/db/client";
import type { SQL } from "drizzle-orm";
import type { SelectedFields } from "drizzle-orm/pg-core";
import type { SelectResultFields } from "drizzle-orm/query-builders/select.types";
import { and, desc, eq, exists, gt, inArray, isNull, like, ne, or, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { isValidSlug, MAX_SLUG_LENGTH } from "@reactive-resume/schema/resume/slug";
import { slugifyStem } from "@reactive-resume/utils/slug";
import { isRandomSlug } from "@reactive-resume/utils/string";
import { ownerIsNotBanned } from "./access-policy";

/** Lowercase letters and numbers, in groups joined by single dashes. Only new and changed slugs must match. */
export { SLUG_PATTERN } from "@reactive-resume/schema/resume/slug";

// After a rename the old address keeps working this long.
const REDIRECT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

const RANDOM_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * A random address, 12 letters and digits with at least two of each, so it can't be guessed from the name and doesn't
 * read as one.
 */
export function randomSlug() {
	for (;;) {
		const bytes = crypto.getRandomValues(new Uint8Array(24));
		// 252 is the largest multiple of 36 below 256, so every character is equally likely.
		const chars = [...bytes].filter((byte) => byte < 252).map((byte) => RANDOM_ALPHABET[byte % 36]);
		const slug = chars.slice(0, 12).join("");
		if (slug.length === 12 && isRandomSlug(slug)) return slug;
	}
}

/** A random address none of the user's resumes uses yet. */
export async function findFreeRandomSlug(client: DbOrTx, userId: string) {
	for (;;) {
		const slug = randomSlug();
		const [taken] = await client
			.select({ id: schema.resume.id })
			.from(schema.resume)
			.where(and(eq(schema.resume.userId, userId), eq(schema.resume.slug, slug)));
		if (!taken) return slug;
	}
}

/** `stem`, or `stem-2`, `stem-3`… whichever isn't taken. */
function pickFreeSlug(stem: string, taken: ReadonlySet<string>) {
	if (!taken.has(stem)) return stem;
	for (let suffix = 2; ; suffix++) {
		if (!taken.has(`${stem}-${suffix}`)) return `${stem}-${suffix}`;
	}
}

// Slugs cannot exceed 64 chars. Keep base stem short enough so numerical suffixes stay within 64.
const MAX_STEM_LENGTH = 56;

/** The stem an app-made address starts from when the resume still has its default name, in any language. */
export const DEFAULT_SLUG_STEM = "resume";

/**
 * A slug made from `name` that none of the user's resumes uses yet, and that no other resume's old address still
 * opens (an app-made address never takes over someone's link). `resumeId` is the resume it's for, whose own address
 * counts as free.
 */
export async function findFreeSlug(client: DbOrTx, userId: string, name: string, resumeId?: string) {
	const rawStem = slugifyStem(name) || DEFAULT_SLUG_STEM;
	const stem = rawStem.slice(0, MAX_STEM_LENGTH).replace(/-+$/, "") || DEFAULT_SLUG_STEM;
	const named = (column: typeof schema.resume.slug | typeof schema.resumeSlugRedirect.slug) =>
		or(eq(column, stem), like(column, `${stem}-%`));
	// Sequential, resumes before redirects: each statement takes a later snapshot, so a redirect that a concurrent
	// address change commits between the two reads is seen. Parallel reads on different pool connections can make
	// the redirect read miss it while the resume read already sees the freed address.
	const resumes = await client
		.select({ slug: schema.resume.slug })
		.from(schema.resume)
		.where(
			and(
				eq(schema.resume.userId, userId),
				named(schema.resume.slug),
				resumeId ? ne(schema.resume.id, resumeId) : undefined,
			),
		);
	const redirects = await client
		.select({ slug: schema.resumeSlugRedirect.slug })
		.from(schema.resumeSlugRedirect)
		.where(
			and(
				eq(schema.resumeSlugRedirect.userId, userId),
				named(schema.resumeSlugRedirect.slug),
				gt(schema.resumeSlugRedirect.expiresAt, sql`now()`),
				resumeId ? ne(schema.resumeSlugRedirect.resumeId, resumeId) : undefined,
			),
		);

	return pickFreeSlug(stem, new Set([...resumes, ...redirects].map((row) => row.slug)));
}

/**
 * Moves a private resume's app-made address to follow its new name. A published resume, or one whose address was
 * chosen by hand, keeps its address. Nobody was sent the old address, so no redirect is kept. When another resume
 * takes the same address at the same moment, this one keeps its current address rather than failing the save.
 */
export async function followNameWithSlug(client: DbOrTx, input: { userId: string; resumeId: string; name: string }) {
	const owned = and(eq(schema.resume.id, input.resumeId), eq(schema.resume.userId, input.userId));
	const [resume] = await client
		.select({ slug: schema.resume.slug, autoSlug: schema.resume.autoSlug, isPublic: schema.resume.isPublic })
		.from(schema.resume)
		.where(owned)
		.for("update");
	if (!resume?.autoSlug || resume.isPublic) return;

	const slug = await findFreeSlug(client, input.userId, input.name, input.resumeId);
	if (slug === resume.slug) return;
	try {
		// Its own savepoint: a lost race leaves the surrounding save intact.
		await client.transaction((savepoint) => savepoint.update(schema.resume).set({ slug }).where(owned));
	} catch (error) {
		if ((error as { cause?: { constraint?: string } } | null)?.cause?.constraint !== "resume_slug_user_id_unique")
			throw error;
	}
}

/**
 * A name none of the user's live resumes has, so two imports of one person stay apart in lists and pickers: `name`,
 * then "name — detail" (the headline), then a number.
 */
export async function findFreeResumeName(userId: string, name: string, detail?: string) {
	const rows = await db
		.select({ name: schema.resume.name })
		.from(schema.resume)
		.where(
			and(
				eq(schema.resume.userId, userId),
				isNull(schema.resume.trashedAt),
				sql`strpos(lower(${schema.resume.name}), lower(${name.slice(0, 94)})) = 1`,
			),
		);
	const taken = new Set(rows.map((row) => row.name.toLowerCase()));
	const free = (candidate: string) => !taken.has(candidate.toLowerCase());
	if (free(name)) return name;
	const described = detail?.trim() && detail.trim() !== name ? `${name} — ${detail.trim()}`.slice(0, 100) : null;
	if (described && free(described)) return described;
	const base = (described ?? name).slice(0, 94);
	for (let number = 2; ; number++) {
		if (free(`${base} (${number})`)) return `${base} (${number})`;
	}
}

/** Whether a slug can be this resume's address, and if not, why and what would work instead. */
export async function checkSlug(input: { userId: string; resumeId: string; slug: string }) {
	const [holder] = await db
		.select({ id: schema.resume.id, name: schema.resume.name })
		.from(schema.resume)
		.where(and(eq(schema.resume.userId, input.userId), eq(schema.resume.slug, input.slug)));

	if (holder?.id === input.resumeId) return { status: "current" as const };

	if (!isValidSlug(input.slug)) {
		const rawSuggestion = slugifyStem(input.slug);
		const candidate = rawSuggestion
			? rawSuggestion.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "") || undefined
			: undefined;

		let suggestion = candidate && candidate !== input.slug ? candidate : undefined;
		if (suggestion) {
			const [candidateHolder] = await db
				.select({ id: schema.resume.id })
				.from(schema.resume)
				.where(and(eq(schema.resume.userId, input.userId), eq(schema.resume.slug, suggestion)));
			if (candidateHolder) {
				// Suggestions never offer the requesting resume's own address as the alternative.
				suggestion = await findFreeSlug(db, input.userId, suggestion);
			}
		}

		return { status: "invalid" as const, ...(suggestion ? { suggestion } : {}) };
	}

	if (!holder) return { status: "available" as const };

	return {
		status: "taken" as const,
		takenBy: holder.name,
		suggestion: await findFreeSlug(db, input.userId, input.slug),
	};
}

/**
 * Keeps the old address working for 30 days after a rename, and frees the new one from any older redirect: a
 * real resume's address always wins over a redirect.
 */
export async function recordSlugChange(
	client: DbOrTx,
	input: { userId: string; resumeId: string; from: string; to: string },
) {
	await client
		.delete(schema.resumeSlugRedirect)
		.where(and(eq(schema.resumeSlugRedirect.userId, input.userId), eq(schema.resumeSlugRedirect.slug, input.to)));

	const expiresAt = new Date(Date.now() + REDIRECT_LIFETIME_MS);
	await client
		.insert(schema.resumeSlugRedirect)
		.values({ userId: input.userId, resumeId: input.resumeId, slug: input.from, expiresAt })
		.onConflictDoUpdate({
			target: [schema.resumeSlugRedirect.userId, schema.resumeSlugRedirect.slug],
			set: { resumeId: input.resumeId, expiresAt },
		});
}

/**
 * Matches a resume owner by username, or by a previous one: upstream's released usernames (kept 30 days, and nobody
 * else can claim them meanwhile), and the fork's username redirects, which count only while no account holds that
 * name, so a real account's username always wins over someone's old one.
 */
export function matchesUsername(username: string) {
	return or(
		eq(schema.user.username, username),
		exists(
			db
				.select({ username: schema.releasedUsername.username })
				.from(schema.releasedUsername)
				.where(
					and(
						eq(schema.releasedUsername.username, username),
						eq(schema.releasedUsername.userId, schema.user.id),
						gt(schema.releasedUsername.releasedAt, sql`now() - interval '30 days'`),
					),
				),
		),
		inArray(
			schema.user.id,
			db
				.select({ id: schema.usernameRedirect.userId })
				.from(schema.usernameRedirect)
				.where(
					and(
						eq(schema.usernameRedirect.username, username),
						gt(schema.usernameRedirect.expiresAt, sql`now()`),
						sql`not exists (select 1 from "user" as taken where taken.username = ${username})`,
					),
				),
		),
	);
}

/** Matches a resume by its slug, or by a previous slug whose redirect hasn't expired. */
export function matchesSlug(slug: string) {
	return or(
		eq(schema.resume.slug, slug),
		inArray(
			schema.resume.id,
			db
				.select({ id: schema.resumeSlugRedirect.resumeId })
				.from(schema.resumeSlugRedirect)
				.where(
					and(
						eq(schema.resumeSlugRedirect.slug, slug),
						eq(schema.resumeSlugRedirect.userId, schema.resume.userId),
						gt(schema.resumeSlugRedirect.expiresAt, sql`now()`),
					),
				),
		),
	);
}

/**
 * Which resume a public address names: a slug (current, or a previous one whose redirect hasn't expired), an account's
 * primary resume, or an ID.
 */
export type ResumeMatch = { username: string; slug: string } | { username: string; primary: true } | { id: string };

/**
 * The resume `match` names, outside Trash, with an unbanned owner and meeting any `extra` conditions. A current
 * username or slug wins over another's redirect.
 */
export async function findResume<TColumns extends SelectedFields>(
	match: ResumeMatch,
	columns: TColumns,
	...extra: (SQL | undefined)[]
): Promise<SelectResultFields<TColumns> | undefined> {
	// Widened for the query builder, whose types can't follow a generic selection; the result is narrowed back.
	const [resume] = await db
		.select(columns as SelectedFields)
		.from(schema.resume)
		.innerJoin(schema.user, eq(schema.resume.userId, schema.user.id))
		.where(
			and(
				"slug" in match ? matchesSlug(match.slug) : undefined,
				// Usernames are stored lowercase, so `/Jane` opens the same page as `/jane`. A previous username whose
				// redirect hasn't expired finds it too, so old links can move to the current address.
				"username" in match ? matchesUsername(match.username.toLowerCase()) : eq(schema.resume.id, match.id),
				"primary" in match ? eq(schema.resume.isPrimary, true) : undefined,
				isNull(schema.resume.trashedAt),
				ownerIsNotBanned(),
				...extra,
			),
		)
		.orderBy(
			...("username" in match ? [desc(sql`${schema.user.username} = ${match.username.toLowerCase()}`)] : []),
			...("slug" in match ? [desc(sql`${schema.resume.slug} = ${match.slug}`)] : []),
		)
		.limit(1);
	return resume as SelectResultFields<TColumns> | undefined;
}
