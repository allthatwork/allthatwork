import type { Application } from "./types";
import type {
	ApplicationSort,
	ApplicationSortDirection,
	ApplicationSortKey,
} from "@reactive-resume/schema/applications/filters";
import { t } from "@lingui/core/macro";
import { getNextStep } from "./next-step";

type SortSource = Pick<
	Application,
	| "role"
	| "company"
	| "status"
	| "activity"
	| "appliedAt"
	| "createdAt"
	| "updatedAt"
	| "followUpAt"
	| "followUpNote"
	| "searchFit"
	| "targetingFit"
>;

/**
 * When the application was sent. Saved ones have none, and neither do closed ones whose timeline shows they never got
 * past Saved; the rest use the applied date on record.
 */
export function appliedDate(application: Pick<Application, "status" | "activity" | "appliedAt">): Date | null {
	if (application.status === "saved") return null;
	if (application.status === "closed") {
		const stages = application.activity.flatMap((entry) => (entry.type === "stage" ? [entry.stage] : []));
		if (stages.length > 0 && stages.every((stage) => stage === "saved" || stage === "closed")) return null;
	}
	return new Date(application.appliedAt);
}

/** The next interview or follow-up; the other next steps have no date. */
function nextStepTime(application: SortSource) {
	const step = getNextStep(application);
	return step.kind === "interview" || step.kind === "follow-up" ? step.at.getTime() : null;
}

const VALUE: Record<ApplicationSortKey, (application: SortSource) => number | string | null> = {
	updated: (application) => new Date(application.updatedAt).getTime(),
	added: (application) => new Date(application.createdAt).getTime(),
	applied: (application) => appliedDate(application)?.getTime() ?? null,
	next: nextStepTime,
	fit: (application) => application.searchFit,
	tfit: (application) => application.targetingFit,
	role: (application) => application.role,
	company: (application) => application.company,
};

const byName = (a: SortSource, b: SortSource) =>
	a.role.localeCompare(b.role, undefined, { sensitivity: "base" }) ||
	a.company.localeCompare(b.company, undefined, { sensitivity: "base" });

/** Orders applications by the sort. Blanks (no fit, no date) go last either way; ties go by role, then company. */
export function compareApplications(sort: ApplicationSort) {
	const value = VALUE[sort.sort];
	const sign = sort.dir === "asc" ? 1 : -1;
	return (a: SortSource, b: SortSource) => {
		const x = value(a);
		const y = value(b);
		if (x === null || y === null) {
			if (x !== y) return x === null ? 1 : -1;
			return byName(a, b);
		}
		const order =
			typeof x === "string" && typeof y === "string"
				? x.localeCompare(y, undefined, { sensitivity: "base" })
				: Number(x) - Number(y);
		return sign * order || byName(a, b);
	};
}

export const sortApplications = <T extends SortSource>(applications: readonly T[], sort: ApplicationSort): T[] =>
	[...applications].sort(compareApplications(sort));

export const getSortLabel = (key: ApplicationSortKey) => {
	switch (key) {
		case "updated":
			return t`Updated`;
		case "added":
			return t`Added`;
		case "applied":
			return t`Applied`;
		case "next":
			return t`Next step`;
		case "fit":
			return t`Fit`;
		case "tfit":
			return t`Targeting fit`;
		case "role":
			return t`Role`;
		case "company":
			return t`Company`;
	}
};

/** The two directions, worded for the field, the one it starts in first. */
export function getDirectionOptions(key: ApplicationSortKey): { dir: ApplicationSortDirection; label: string }[] {
	switch (key) {
		case "updated":
		case "added":
		case "applied":
			return [
				{ dir: "desc", label: t`Newest first` },
				{ dir: "asc", label: t`Oldest first` },
			];
		case "fit":
		case "tfit":
			return [
				{ dir: "desc", label: t`Highest first` },
				{ dir: "asc", label: t`Lowest first` },
			];
		case "next":
			return [
				{ dir: "asc", label: t`Soonest first` },
				{ dir: "desc", label: t`Latest first` },
			];
		case "role":
		case "company":
			return [
				{ dir: "asc", label: t`A to Z` },
				{ dir: "desc", label: t`Z to A` },
			];
	}
}
