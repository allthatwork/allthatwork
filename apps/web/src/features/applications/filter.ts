import type { Application } from "./types";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { ApplicationFilters } from "@reactive-resume/schema/applications/filters";
import { t } from "@lingui/core/macro";
import { APPLICATION_STATUSES } from "@reactive-resume/schema/applications/data";
import {
	ATTENTION_FILTER_VALUES,
	BUILD_FILTER_VALUES,
	DEFAULT_APPLICATION_FILTERS,
	NOT_SET,
	OPEN_STAGES,
} from "@reactive-resume/schema/applications/filters";
import { NO_REPLY_DAYS } from "@reactive-resume/utils/reminders";
import { getNextStep } from "./next-step";
import { getStageLabel } from "./stages";
import { suggestValues } from "./suggestions";

const DAY_MS = 86_400_000;

/** The filter buttons in the order they show: these five always, then the "More filters" ones once picked or set. */
export const PRIMARY_FACETS = ["stage", "build", "foundBy", "lane", "fit"] as const;
export const EXTRA_FACETS = ["source", "documents", "attention", "dates", "tags"] as const;
export type FilterFacet = (typeof PRIMARY_FACETS)[number] | (typeof EXTRA_FACETS)[number];
export const FACETS: readonly FilterFacet[] = [...PRIMARY_FACETS, ...EXTRA_FACETS];

/** Facets whose options are a list of values, each with a count. */
export type ListFacet = "stage" | "build" | "foundBy" | "lane" | "source" | "attention" | "tags";

export type BuildFilterValue = (typeof BUILD_FILTER_VALUES)[number];
export type AttentionKind = (typeof ATTENTION_FILTER_VALUES)[number];

export type FilterContext = {
	now: Date;
	/** Days at Applied before "no reply"; 0 never flags it. Pass `useNoReplyDays()`. */
	noReplyDays: number;
};

/** Free-text values (Found by, Found on, lanes, tags) match ignoring case and outer spaces. */
const keyOf = (value: string) => value.trim().toLocaleLowerCase();
const keySet = (values: readonly string[]) => new Set(values.map(keyOf));

const sameSet = (a: readonly string[], b: readonly string[]) => {
	const left = keySet(a);
	const right = keySet(b);
	return left.size === right.size && [...left].every((value) => right.has(value));
};

export const resumeLinked = (application: Application) => Boolean(application.resumeId || application.resumeFileUrl);
export const letterLinked = (application: Application) =>
	Boolean(application.coverLetterId || application.coverLetterUrl);

/** What needs the user on this application: a reply that's late, a follow-up that's due, an interview, open questions. */
export function attentionOf(application: Application, { now, noReplyDays }: FilterContext): AttentionKind[] {
	const kinds: AttentionKind[] = [];
	const step = getNextStep(application, { now, noReplyDays });
	if (step.kind === "no-reply") kinds.push("no-reply");
	if (step.kind === "follow-up" && step.overdue) kinds.push("follow-up");
	if (step.kind === "interview") kinds.push("interview");
	if (application.targetingQuestions.some((question) => question.status === "open")) kinds.push("questions");
	return kinds;
}

/** The values an application holds for a list facet; "none" stands for not set. */
function valuesOf(application: Application, facet: ListFacet, filters: ApplicationFilters, context: FilterContext) {
	switch (facet) {
		case "stage":
			return [application.status];
		case "build":
			return [application.targetingBuildStatus ?? NOT_SET];
		case "foundBy":
			return [application.foundBy?.trim() || NOT_SET];
		case "source":
			return [application.source?.trim() || NOT_SET];
		case "lane": {
			const primary = application.targetingPrimaryLane?.trim() || null;
			const secondary = application.targetingSecondaryLane?.trim() || null;
			// "No lane" means no primary lane, in either mode.
			if (filters.laneMode === "primary") return [primary ?? NOT_SET];
			return [primary ?? NOT_SET, ...(secondary ? [secondary] : [])];
		}
		case "attention":
			return attentionOf(application, context);
		case "tags":
			return application.tags;
	}
}

const fitOk = (fit: number | null, wanted: string) =>
	wanted === "any" ? true : wanted === NOT_SET ? fit === null : fit !== null && fit >= Number(wanted);

const documentOk = (linked: boolean, wanted: ApplicationFilters["resume"]) =>
	wanted === "any" ? true : wanted === "linked" ? linked : !linked;

const withinDays = (date: Date | string, days: ApplicationFilters["added"], now: Date) =>
	days === "any" || now.getTime() - new Date(date).getTime() <= Number(days) * DAY_MS;

/** Search reads role, company, location, contacts and tags. */
export function matchesSearch(application: Application, query: string) {
	const text = query.trim().toLocaleLowerCase();
	if (!text) return true;
	const haystack = [
		application.role,
		application.company,
		application.location ?? "",
		...application.contacts.map((contact) => contact.name),
		...application.tags,
	]
		.join(" ")
		.toLocaleLowerCase();
	return haystack.includes(text);
}

function matchesTags(application: Application, filters: ApplicationFilters) {
	const tags = keySet(application.tags);
	// Exclusion wins.
	if (filters.notTag.some((tag) => tags.has(keyOf(tag)))) return false;
	if (filters.tag.length === 0) return true;
	return filters.tagMode === "all"
		? filters.tag.every((tag) => tags.has(keyOf(tag)))
		: filters.tag.some((tag) => tags.has(keyOf(tag)));
}

export function matchesFacet(
	application: Application,
	filters: ApplicationFilters,
	facet: FilterFacet,
	context: FilterContext,
): boolean {
	switch (facet) {
		case "stage":
			return filters.stage.length === 0 || filters.stage.includes(application.status);
		case "build":
		case "foundBy":
		case "lane":
		case "source":
		case "attention": {
			const wanted = filters[facet];
			if (wanted.length === 0) return true;
			const keys = keySet(wanted);
			return valuesOf(application, facet, filters, context).some((value) => keys.has(keyOf(value)));
		}
		case "fit":
			return fitOk(application.searchFit, filters.fit) && fitOk(application.targetingFit, filters.tfit);
		case "documents":
			return (
				documentOk(resumeLinked(application), filters.resume) && documentOk(letterLinked(application), filters.letter)
			);
		case "dates":
			return (
				withinDays(application.createdAt, filters.added, context.now) &&
				withinDays(application.updatedAt, filters.updated, context.now)
			);
		case "tags":
			return matchesTags(application, filters);
	}
}

/** Whether an application passes every filter, the search included; `skip` leaves one facet out (for its counts). */
export function matchesFilters(
	application: Application,
	filters: ApplicationFilters,
	context: FilterContext,
	skip?: FilterFacet,
) {
	if (!matchesSearch(application, filters.q)) return false;
	return FACETS.every((facet) => facet === skip || matchesFacet(application, filters, facet, context));
}

export const filterApplications = (
	applications: readonly Application[],
	filters: ApplicationFilters,
	context: FilterContext,
) => applications.filter((application) => matchesFilters(application, filters, context));

/**
 * Each option's count for a list facet: how many would show if only that option were picked, with every other filter
 * (the search included) applied. Look a value up with the returned function; unknown values count 0.
 */
export function optionCounts(
	applications: readonly Application[],
	filters: ApplicationFilters,
	facet: ListFacet,
	context: FilterContext,
): (value: string) => number {
	const counts = new Map<string, number>();
	const skip: FilterFacet = facet;
	for (const application of applications) {
		if (!matchesFilters(application, filters, context, skip)) continue;
		for (const value of new Set(valuesOf(application, facet, filters, context).map(keyOf))) {
			counts.set(value, (counts.get(value) ?? 0) + 1);
		}
	}
	return (value) => counts.get(keyOf(value)) ?? 0;
}

type InUseField = "foundBy" | "source" | "tags";

const pickField = (field: InUseField) => (application: Application) =>
	field === "tags" ? application.tags : [application[field]];

/** The values in use for Found by, Found on or tags: most used first, then by name (case-insensitive, as first spelled). */
export const valuesInUse = (applications: readonly Application[], field: InUseField) =>
	suggestValues([...applications], pickField(field));

/** Whether any application has no value for Found by or Found on, so "Not set" is worth listing. */
export const anyUnset = (applications: readonly Application[], field: "foundBy" | "source") =>
	applications.some((application) => !application[field]?.trim());

/** Values the filters hold that aren't in `values` (say, from an old link), so they can still be unticked. */
export const withSelected = (values: readonly string[], selected: readonly string[]) => {
	const keys = keySet(values);
	return [...values, ...selected.filter((value) => !keys.has(keyOf(value)))];
};

export function isFacetSet(filters: ApplicationFilters, facet: FilterFacet): boolean {
	switch (facet) {
		case "stage":
			return !sameSet(filters.stage, OPEN_STAGES);
		case "build":
		case "foundBy":
		case "source":
		case "attention":
			return filters[facet].length > 0;
		case "lane":
			return filters.lane.length > 0;
		case "fit":
			return filters.fit !== "any" || filters.tfit !== "any";
		case "documents":
			return filters.resume !== "any" || filters.letter !== "any";
		case "dates":
			return filters.added !== "any" || filters.updated !== "any";
		case "tags":
			return filters.tag.length > 0 || filters.notTag.length > 0;
	}
}

/** How many filters are set (the search text not counted); the phone's Filters button shows it. */
export const activeFilterCount = (filters: ApplicationFilters) =>
	FACETS.filter((facet) => isFacetSet(filters, facet)).length;

/** The same filters, whatever the order of their values (and ignoring case in free-text values). */
export function sameFilters(a: ApplicationFilters, b: ApplicationFilters) {
	return (Object.keys(DEFAULT_APPLICATION_FILTERS) as (keyof ApplicationFilters)[]).every((key) => {
		const left = a[key];
		const right = b[key];
		if (Array.isArray(left) && Array.isArray(right)) return sameSet(left, right);
		if (key === "q") return String(left).trim() === String(right).trim();
		return left === right;
	});
}

/** Nothing filtered beyond the default (the five open stages), and no search text. */
export const isDefaultFilters = (filters: ApplicationFilters) => sameFilters(filters, DEFAULT_APPLICATION_FILTERS);

/** The filters with one facet back at its default. */
export function clearFacet(filters: ApplicationFilters, facet: FilterFacet): ApplicationFilters {
	const d = DEFAULT_APPLICATION_FILTERS;
	switch (facet) {
		case "stage":
			return { ...filters, stage: [...d.stage] };
		case "lane":
			return { ...filters, lane: [], laneMode: d.laneMode };
		case "fit":
			return { ...filters, fit: d.fit, tfit: d.tfit };
		case "documents":
			return { ...filters, resume: d.resume, letter: d.letter };
		case "dates":
			return { ...filters, added: d.added, updated: d.updated };
		case "tags":
			return { ...filters, tag: [], notTag: [], tagMode: d.tagMode };
		default:
			return { ...filters, [facet]: [] };
	}
}

/** Every filter back at its default, the search included. */
export const clearAll = (): ApplicationFilters => ({ ...DEFAULT_APPLICATION_FILTERS, stage: [...OPEN_STAGES] });

/** Adds or removes one value; stages stay in pipeline order and the last one can't be removed. */
export function toggleValue<T extends string>(values: readonly T[], value: T): T[] {
	const key = keyOf(value);
	return values.some((item) => keyOf(item) === key) ? values.filter((item) => keyOf(item) !== key) : [...values, value];
}

export function toggleStage(stages: readonly ApplicationStatus[], stage: ApplicationStatus): ApplicationStatus[] {
	const next = toggleValue(stages, stage);
	if (next.length === 0) return [...stages];
	return APPLICATION_STATUSES.filter((status) => next.includes(status));
}

/** Tags: + must have, − must not; picking the same mark again clears it. */
export function markTag(filters: ApplicationFilters, tag: string, mark: "in" | "out"): ApplicationFilters {
	const key = keyOf(tag);
	const wasIn = filters.tag.some((item) => keyOf(item) === key);
	const wasOut = filters.notTag.some((item) => keyOf(item) === key);
	const tagList = filters.tag.filter((item) => keyOf(item) !== key);
	const notTag = filters.notTag.filter((item) => keyOf(item) !== key);
	if (mark === "in" && !wasIn) tagList.push(tag);
	if (mark === "out" && !wasOut) notTag.push(tag);
	return { ...filters, tag: tagList, notTag, tagMode: tagList.length > 1 ? filters.tagMode : "any" };
}

export const tagMark = (filters: ApplicationFilters, tag: string): "in" | "out" | null => {
	const key = keyOf(tag);
	if (filters.tag.some((item) => keyOf(item) === key)) return "in";
	if (filters.notTag.some((item) => keyOf(item) === key)) return "out";
	return null;
};

// Labels

export const getFacetLabel = (facet: FilterFacet) =>
	({
		stage: t`Stage`,
		build: t`Build`,
		foundBy: t`Found by`,
		lane: t`Lane`,
		fit: t`Fit`,
		source: t`Found on`,
		documents: t`Documents`,
		attention: t`Needs attention`,
		dates: t`Dates`,
		tags: t`Tags`,
	})[facet];

export const getBuildFilterLabel = (value: BuildFilterValue) =>
	({
		none: t`Not queued`,
		build: t`Queued`,
		building: t`Building`,
		built: t`Built`,
		failed: t`Failed`,
	})[value];

export const getAttentionLabel = (kind: AttentionKind, noReplyDays: number = NO_REPLY_DAYS.default) =>
	({
		"no-reply": t`No reply in ${noReplyDays}+ days`,
		"follow-up": t`Follow-up due`,
		interview: t`Interview coming`,
		questions: t`Questions to answer`,
	})[kind];

/** "Not set" for Found by and Found on; the value itself otherwise. */
export const notSetLabel = (value: string) => (value === NOT_SET ? t`Not set` : value);
export const laneLabel = (value: string) => (value === NOT_SET ? t`No lane` : value);

/** One or two values by name, three or more as a count. */
const listValue = (labels: readonly string[]) => (labels.length <= 2 ? labels.join(", ") : String(labels.length));

const IN_FLIGHT: readonly ApplicationStatus[] = ["applied", "screening", "interview", "offer"];

type SummaryOptions = { noReplyDays?: number };

/**
 * What a filter button says after its label ("Build: Built", "Found by: Dorel, Muse", "Fit: Search 85+"), or null when
 * the filter isn't set. Stage always has one ("Open" by default).
 */
export function summary(
	filters: ApplicationFilters,
	facet: FilterFacet,
	{ noReplyDays = NO_REPLY_DAYS.default }: SummaryOptions = {},
): string | null {
	if (facet === "stage") {
		if (sameSet(filters.stage, OPEN_STAGES)) return t`Open`;
		if (sameSet(filters.stage, APPLICATION_STATUSES)) return t`All`;
		if (sameSet(filters.stage, IN_FLIGHT)) return t`Applied to Offer`;
		return listValue(
			APPLICATION_STATUSES.filter((status) => filters.stage.includes(status)).map((status) => getStageLabel(status)),
		);
	}
	if (!isFacetSet(filters, facet)) return null;
	switch (facet) {
		case "build":
			return listValue(filters.build.map(getBuildFilterLabel));
		case "foundBy":
		case "source":
			return listValue(filters[facet].map(notSetLabel));
		case "lane":
			return listValue(filters.lane.map(laneLabel));
		case "attention":
			return listValue(filters.attention.map((kind) => getAttentionLabel(kind, noReplyDays)));
		case "fit": {
			const parts: string[] = [];
			if (filters.fit !== "any") parts.push(filters.fit === NOT_SET ? t`No search fit` : t`Search ${filters.fit}+`);
			if (filters.tfit !== "any")
				parts.push(filters.tfit === NOT_SET ? t`No targeting fit` : t`Targeting ${filters.tfit}+`);
			return parts.join(", ");
		}
		case "documents": {
			const parts: string[] = [];
			if (filters.resume !== "any") parts.push(filters.resume === "linked" ? t`Resume` : t`No resume`);
			if (filters.letter !== "any") parts.push(filters.letter === "linked" ? t`Letter` : t`No letter`);
			return parts.join(", ");
		}
		case "dates": {
			const parts: string[] = [];
			if (filters.added !== "any") parts.push(t`Added ${filters.added}d`);
			if (filters.updated !== "any") parts.push(t`Updated ${filters.updated}d`);
			return parts.join(", ");
		}
		case "tags": {
			const parts = [...filters.tag.map((tag) => `#${tag}`), ...filters.notTag.map((tag) => t`not #${tag}`)];
			return listValue(parts);
		}
	}
}

// Cards changed while filtered

/** Where each application showed at the last filter change: its id and the stage it was under. */
export type ShownSnapshot = ReadonlyMap<string, ApplicationStatus>;

export const snapshotOf = (applications: readonly Application[]): ShownSnapshot =>
	new Map(applications.map((application) => [application.id, application.status]));

type HeldResult = {
	/** What the filters match: the count and Export use these. */
	matching: Application[];
	/** What's on screen: the matching ones plus those shown at the last filter change that stopped matching. */
	shown: Application[];
	/** The shown ones that no longer match, with the stage they showed under. */
	stale: Map<string, ApplicationStatus>;
};

/**
 * A card changed while filtered stays where it was until the filters change: everything shown at the last filter change
 * stays on screen, marked, even when it no longer matches.
 */
export function withHeld(
	applications: readonly Application[],
	isMatch: (application: Application) => boolean,
	snapshot: ShownSnapshot,
): HeldResult {
	const matching: Application[] = [];
	const shown: Application[] = [];
	const stale = new Map<string, ApplicationStatus>();
	for (const application of applications) {
		if (isMatch(application)) {
			matching.push(application);
			shown.push(application);
			continue;
		}
		const was = snapshot.get(application.id);
		if (was === undefined) continue;
		shown.push(application);
		stale.set(application.id, was);
	}
	// Cards keep the order they had in the snapshot, so a card that's just changed (and so updated most recently)
	// doesn't jump to the top of its column. Anything not in it yet goes first, as the newest.
	const order = new Map([...snapshot.keys()].map((id, index) => [id, index]));
	shown.sort((a, b) => (order.get(a.id) ?? -1) - (order.get(b.id) ?? -1));
	return { matching, shown, stale };
}

// Options

export type FilterOption = { value: string; label: string; count: number };

/** Lanes from Preferences first, then lanes in use that aren't there (most used first). */
function laneValues(applications: readonly Application[], preferenceLanes: readonly string[]) {
	const used = suggestValues([...applications], (application) => [
		application.targetingPrimaryLane,
		application.targetingSecondaryLane,
	]);
	return withSelected(preferenceLanes, used);
}

type FacetOptionsInput = {
	applications: readonly Application[];
	filters: ApplicationFilters;
	context: FilterContext;
	/** The lanes from Preferences. */
	lanes?: readonly string[];
};

/**
 * The options a list facet offers, in order, each with its count given the other filters. Values the filters hold but
 * nobody uses any more stay listed so they can be unticked; options at 0 stay too, so the list doesn't jump.
 */
export function facetOptions(facet: ListFacet, { applications, filters, context, lanes = [] }: FacetOptionsInput) {
	const count = optionCounts(applications, filters, facet, context);
	const option = (value: string, label: string): FilterOption => ({ value, label, count: count(value) });

	switch (facet) {
		case "stage":
			return APPLICATION_STATUSES.map((status) => option(status, getStageLabel(status)));
		case "build":
			return BUILD_FILTER_VALUES.map((value) => option(value, getBuildFilterLabel(value)));
		case "foundBy":
		case "source": {
			const values = withSelected(valuesInUse(applications, facet), filters[facet]).filter(
				(value) => value !== NOT_SET,
			);
			const unset = anyUnset(applications, facet) || filters[facet].includes(NOT_SET);
			return [...values, ...(unset ? [NOT_SET] : [])].map((value) => option(value, notSetLabel(value)));
		}
		case "lane": {
			const values = withSelected(laneValues(applications, lanes), filters.lane).filter((value) => value !== NOT_SET);
			return [...values, NOT_SET].map((value) => option(value, laneLabel(value)));
		}
		case "attention":
			return ATTENTION_FILTER_VALUES.filter(
				(kind) => kind !== "no-reply" || context.noReplyDays > 0 || filters.attention.includes(kind),
			).map((kind) => option(kind, getAttentionLabel(kind, context.noReplyDays)));
		case "tags":
			return withSelected(valuesInUse(applications, "tags"), [...filters.tag, ...filters.notTag]).map((tag) =>
				option(tag, tag),
			);
	}
}

/**
 * The snapshot with every matching application in it (at its current stage), or null when nothing changed. Ones new to
 * it go first, as the newest; the rest keep their place, so one that stops matching later stays where it was, under
 * the stage it last matched in.
 */
export function mergeSnapshot(snapshot: ShownSnapshot, matching: readonly Application[]): ShownSnapshot | null {
	if (matching.every((application) => snapshot.get(application.id) === application.status)) return null;
	const added = matching.filter((application) => !snapshot.has(application.id));
	const next = new Map<string, ApplicationStatus>(added.map((application) => [application.id, application.status]));
	for (const [id, status] of snapshot) next.set(id, status);
	for (const application of matching) if (snapshot.has(application.id)) next.set(application.id, application.status);
	return next;
}
