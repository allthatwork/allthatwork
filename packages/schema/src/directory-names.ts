/**
 * Contact and company names in the Directory: cleaning imported text, building a contact's full name from its parts,
 * and sorting and grouping lists A to Z. Contacts sort by last name, companies by name.
 */

// Emoji and their glue: pictographs, skin-tone modifiers, zero-width joiners, variation selectors, keycaps and the
// tag characters of subdivision flags.
const EMOJI = /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200D|\uFE0E|\uFE0F|\u20E3|[\u{E0020}-\u{E007F}]/gu;
// Other symbols (category So: ®, ™, ©, ★, ✓, flags' regional indicators).
const SYMBOLS = /\p{So}/gu;

/**
 * Cleans a name, company or position read from an import: emoji and decorative symbols out, fancy letters (𝗝𝗼𝗵𝗻)
 * made plain, spaces collapsed. Letters in any script, accents, digits and punctuation stay. A field that cleaning
 * would empty keeps its original text. Names typed by hand are saved as typed and never pass through here.
 */
export function cleanImportedText(value: string): string {
	// Pictographs go before NFKC, which would otherwise turn ™ into "TM".
	const cleaned = value
		.replace(EMOJI, "")
		.normalize("NFKC")
		.replace(EMOJI, "")
		.replace(SYMBOLS, "")
		.replace(/\s+/g, " ")
		.trim();
	return cleaned || value.trim();
}

/** The full name shown everywhere, rebuilt from first and last name on every save. */
export const contactFullName = (firstName: string, lastName: string) =>
	[firstName.trim(), lastName.trim()].filter(Boolean).join(" ");

type NameInput = { name?: string | undefined; firstName?: string | undefined; lastName?: string | undefined };
type NameParts = { firstName: string; lastName: string };

/**
 * A contact's names from a create or update. First and last name win; a lone `name` (older clients, MCP) is stored as
 * the first name with no last name; an update that names neither keeps the current ones (null). Throws nothing: an
 * empty result has `name === ""`, which callers reject.
 */
export function contactNames(input: NameInput, current?: NameParts): (NameParts & { name: string }) | null {
	let parts: NameParts;
	if (input.firstName !== undefined || input.lastName !== undefined)
		parts = {
			firstName: (input.firstName ?? current?.firstName ?? "").trim(),
			lastName: (input.lastName ?? current?.lastName ?? "").trim(),
		};
	else if (input.name !== undefined) parts = { firstName: input.name.trim(), lastName: "" };
	else if (current) return null;
	else parts = { firstName: "", lastName: "" };
	return { ...parts, name: contactFullName(parts.firstName, parts.lastName) };
}

/**
 * What a contact sorts and files under: the last name without anything from its first comma on (credentials,
 * "Menon, PMP") and without parenthesized parts ("Lee (Kim)"). Empty when there's no last name.
 */
export const contactSortKey = (lastName: string) =>
	lastName
		.replace(/,.*$/s, "")
		.replace(/\([^)]*\)?/g, " ")
		.replace(/\s+/g, " ")
		.trim();

export const DIRECTORY_LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"] as const;
export type DirectoryLetter = (typeof DIRECTORY_LETTERS)[number];
/** Latin letters that don't decompose into a base letter and an accent. */
const FOLDED: Record<string, string> = { Æ: "A", Ð: "D", Đ: "D", Ł: "L", Ø: "O", Œ: "O", Þ: "T", ẞ: "S" };

/**
 * The letter a key files under: its first A to Z letter after leading emoji, symbols and punctuation, accents
 * removed (É files under E). Anything else (a digit, another script) files under #.
 */
export function directoryLetter(key: string): DirectoryLetter {
	const first = /[\p{L}\p{N}]/u.exec(key.normalize("NFKC"))?.[0];
	if (!first) return "#";
	const upper = first.toUpperCase();
	const base = FOLDED[upper] ?? upper.normalize("NFD").replace(/\p{M}/gu, "");
	return /^[A-Z]$/.test(base) ? (base as DirectoryLetter) : "#";
}

/** "none" holds contacts with no last name, after #. */
export type DirectoryGroupKey = DirectoryLetter | "none";
export type DirectoryGroup<T> = { key: DirectoryGroupKey; items: T[] };

const collators = new Map<string, Intl.Collator>();
const collator = (locale?: string) => {
	const id = locale ?? "";
	let found = collators.get(id);
	if (!found) {
		found = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
		collators.set(id, found);
	}
	return found;
};

const GROUP_ORDER = new Map<DirectoryGroupKey, number>(
	[...DIRECTORY_LETTERS, "none" as const].map((key, i) => [key, i]),
);

type Sortable<T> = { item: T; group: DirectoryGroupKey; keys: string[] };

function compareSortables(a: Omit<Sortable<unknown>, "item">, b: Omit<Sortable<unknown>, "item">, locale?: string) {
	const compare = collator(locale).compare;
	const byGroup = (GROUP_ORDER.get(a.group) ?? 0) - (GROUP_ORDER.get(b.group) ?? 0);
	if (byGroup) return byGroup;
	for (let i = 0; i < Math.max(a.keys.length, b.keys.length); i++) {
		const result = compare(a.keys[i] ?? "", b.keys[i] ?? "");
		if (result) return result;
	}
	return 0;
}

function grouped<T>(rows: Sortable<T>[], locale?: string): DirectoryGroup<T>[] {
	rows.sort((a, b) => compareSortables(a, b, locale));
	const groups: DirectoryGroup<T>[] = [];
	for (const row of rows) {
		const last = groups.at(-1);
		if (last?.key === row.group) last.items.push(row.item);
		else groups.push({ key: row.group, items: [row.item] });
	}
	return groups;
}

type NamedContact = { firstName: string; lastName: string; name: string };

const contactSortable = <T extends NamedContact>(item: T): Sortable<T> => {
	const key = contactSortKey(item.lastName);
	return key
		? { item, group: directoryLetter(key), keys: [key, item.firstName, item.lastName, item.name] }
		: { item, group: "none", keys: [item.firstName, item.name] };
};

/** The group a contact files under: a letter, #, or "none" without a last name. */
export const contactGroup = (contact: NamedContact) => contactSortable(contact).group;

/** Contacts by last name, then first name, ignoring case and accents; no last name last, by first name. */
export function groupContacts<T extends NamedContact>(contacts: readonly T[], locale?: string): DirectoryGroup<T>[] {
	return grouped(contacts.map(contactSortable), locale);
}

/** The contact order as a comparator, for lists grouped some other way (by company in the LinkedIn review). */
export const compareContacts = (a: NamedContact, b: NamedContact, locale?: string) =>
	compareSortables(contactSortable(a), contactSortable(b), locale);

export const sortContacts = <T extends NamedContact>(contacts: readonly T[], locale?: string): T[] =>
	groupContacts(contacts, locale).flatMap((group) => group.items);

/** Companies by name, ignoring case and accents, under the same letters. */
export function groupCompanies<T extends { name: string }>(companies: readonly T[], locale?: string) {
	return grouped(
		companies.map((item) => ({ item, group: directoryLetter(item.name), keys: [item.name] })),
		locale,
	);
}
