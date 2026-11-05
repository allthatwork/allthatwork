import type { Application } from "../../types";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { useInvalidateApplications } from "../../use-application-actions";
import { ApplicationNotes } from "../application-notes";
import { BuildStatusControl } from "../build-status";
import { AssistantMarkdown } from "@/features/assistant/markdown";
import { orpc } from "@/libs/orpc/client";

type UpdateInput = Parameters<ReturnType<typeof orpc.applications.update.mutationOptions>["mutationFn"] & {}>[0];

function useUpdate(id: string) {
	const invalidate = useInvalidateApplications();
	return useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => invalidate(id),
		onError: () => toast.add({ type: "error", description: t`Couldn't save.` }),
	});
}

type ReadOnlyFactProps = { label: string; children: ReactNode };

function ReadOnlyFact({ label, children }: ReadOnlyFactProps) {
	return (
		<div className="grid min-w-0 gap-0.5">
			<dt className="text-xs font-semibold text-ink-3 uppercase">{label}</dt>
			<dd className="truncate text-sm font-medium">{children}</dd>
		</div>
	);
}

const percent = (fit: number | null) => (fit === null ? "—" : `${fit}%`);

function AssessedOn({ at, locale }: { at: Date | string | null; locale: string }) {
	if (!at) return null;
	const date = new Date(at).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
	return <span className="text-xs text-ink-3">{date}</span>;
}

type SearchSectionProps = { application: Application; locale: string };

/** What the job search made of the posting: its fit (the search's number, not editable here) and its notes. */
export function SearchSection({ application, locale }: SearchSectionProps) {
	return (
		<section aria-labelledby="application-search" className="grid gap-3">
			<div className="flex items-baseline justify-between gap-2">
				<h3 id="application-search" className="text-xs font-semibold text-ink-3 uppercase">
					<Trans>Search</Trans>
				</h3>
				<AssessedOn at={application.searchAt} locale={locale} />
			</div>
			<dl className="grid grid-cols-2 gap-x-4 gap-y-3">
				<ReadOnlyFact label={t`Search fit`}>{percent(application.searchFit)}</ReadOnlyFact>
			</dl>
			<ApplicationNotes
				application={application}
				field="searchNotes"
				label={t`Search notes`}
				placeholder={t`What the search found: strengths, gaps, unknowns`}
				rows={application.searchNotes ? 6 : 2}
			/>
		</section>
	);
}

type LaneSelectProps = {
	label: string;
	value: string | null;
	lanes: readonly string[];
	onSave: (value: string | null) => void;
};

/** A lane picked from the Preferences list; a saved lane that isn't on the list stays as an option, marked. */
function LaneSelect({ label, value, lanes, onSave }: LaneSelectProps) {
	const id = useId();
	const unlisted = value !== null && !lanes.includes(value);
	return (
		<div className="grid min-w-0 gap-0.5">
			<dt className="text-xs font-semibold text-ink-3 uppercase">
				<label htmlFor={id}>{label}</label>
			</dt>
			<dd className="min-w-0">
				<select
					id={id}
					value={value ?? ""}
					onChange={(event) => {
						const next = event.target.value || null;
						if (next !== value) onSave(next);
					}}
					className="h-8 w-full truncate rounded-md border border-line bg-surface px-2 text-sm font-medium"
				>
					<option value="">{t`None`}</option>
					{lanes.map((lane) => (
						<option key={lane} value={lane}>
							{lane}
						</option>
					))}
					{unlisted && <option value={value}>{t`${value} (not in Preferences)`}</option>}
				</select>
			</dd>
		</div>
	);
}

/** The latest review round as "B 72% · C 78% · A 35% · D skipped", each reviewer's model and verdict on hover. */
function Reviews({ reviews }: { reviews: Application["targetingReviews"] }) {
	if (reviews.length === 0) return null;
	const round = Math.max(...reviews.map((review) => review.round));
	const latest = reviews.filter((review) => review.round === round);
	return (
		<div className="grid gap-1.5">
			<p className="text-xs font-semibold text-ink-3 uppercase">
				<Trans>Reviewers · round {round}</Trans>
			</p>
			<ul className="grid gap-1">
				{latest.map((review) => (
					<li
						key={`${review.round}-${review.reviewer}`}
						className="flex min-w-0 items-baseline gap-2 text-[13px] text-ink-2"
					>
						<span className="w-5 shrink-0 font-semibold text-ink">{review.reviewer}</span>
						<span className="w-12 shrink-0 text-ink tabular-nums">
							{review.status === "ran" ? percent(review.fit) : t`skipped`}
						</span>
						<span className="min-w-0 truncate" title={review.status === "ran" ? review.verdict : (review.reason ?? "")}>
							{review.model}
							{review.status === "ran"
								? review.verdict && ` · ${review.verdict}`
								: review.reason && ` · ${review.reason}`}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

type TargetingSectionProps = {
	application: Application;
	/** The whole targeting note; the list leaves it out, so it comes from the full application once loaded. */
	targetingNotes: string | null | undefined;
	/** The lanes from Preferences. */
	lanes: readonly string[];
	locale: string;
};

/**
 * What targeting a resume at the posting produced: its fit (the reviewers' median, not editable), each reviewer's
 * score, the lanes it aimed at (picked from Preferences), and the whole targeting note.
 */
export function TargetingSection({ application, targetingNotes, lanes, locale }: TargetingSectionProps) {
	const update = useUpdate(application.id);
	const save = (input: Omit<UpdateInput, "id">) => update.mutate({ id: application.id, ...input });

	return (
		<section aria-labelledby="application-targeting" className="grid gap-3">
			<div className="flex items-baseline justify-between gap-2">
				<h3 id="application-targeting" className="text-xs font-semibold text-ink-3 uppercase">
					<Trans>Targeting</Trans>
				</h3>
				<AssessedOn at={application.targetingAt} locale={locale} />
			</div>
			<dl className="grid grid-cols-2 gap-x-4 gap-y-3">
				<ReadOnlyFact label={t`Targeting fit`}>{percent(application.targetingFit)}</ReadOnlyFact>
				<div className="grid min-w-0 gap-0.5">
					<dt className="text-xs font-semibold text-ink-3 uppercase">
						<Trans>Build status</Trans>
					</dt>
					<dd className="flex min-h-6 flex-wrap items-center gap-2">
						<BuildStatusControl application={application} />
						{application.targetingBuildStatus === "failed" && (
							<Button variant="secondary" size="sm" onClick={() => save({ targetingBuildStatus: "build" })}>
								<Icon name="arrow-clockwise" size={14} />
								<Trans>Retry build</Trans>
							</Button>
						)}
						{application.targetingBuildStatus === "built" && (
							<Button variant="ghost" size="sm" onClick={() => save({ targetingBuildStatus: "build" })}>
								<Icon name="arrow-clockwise" size={14} />
								<Trans>Rebuild</Trans>
							</Button>
						)}
						{application.targetingBuildStatus === "building" && (
							<Button variant="ghost" size="sm" onClick={() => save({ targetingBuildStatus: null })}>
								<Trans>Cancel</Trans>
							</Button>
						)}
					</dd>
				</div>
				<LaneSelect
					label={t`Primary lane`}
					value={application.targetingPrimaryLane}
					lanes={lanes}
					onSave={(targetingPrimaryLane) => save({ targetingPrimaryLane })}
				/>
				<LaneSelect
					label={t`Secondary lane`}
					value={application.targetingSecondaryLane}
					lanes={lanes}
					onSave={(targetingSecondaryLane) => save({ targetingSecondaryLane })}
				/>
			</dl>
			<Link
				to="/dashboard/career/knowledge/preferences"
				className="w-fit text-xs text-ink-3 hover:text-ink-2 hover:underline"
			>
				{lanes.length ? <Trans>Edit lanes in Preferences</Trans> : <Trans>Add your lanes in Preferences</Trans>}
			</Link>
			<Reviews reviews={application.targetingReviews} />
			{targetingNotes && <TargetingNoteButton application={application} notes={targetingNotes} />}
		</section>
	);
}

type TargetingNoteButtonProps = {
	application: Pick<Application, "role" | "company">;
	notes: string;
	className?: string;
};

/** Read the targeting note button and the wide dialog it opens, with the whole note as Markdown. */
export function TargetingNoteButton({ application, notes, className }: TargetingNoteButtonProps) {
	const [reading, setReading] = useState(false);
	return (
		<>
			<Button variant="secondary" size="sm" className={cn("w-fit", className)} onClick={() => setReading(true)}>
				<Icon name="file-text" size={16} />
				<Trans>Read the targeting note</Trans>
			</Button>
			<Dialog open={reading} onOpenChange={setReading}>
				<DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
					<DialogHeader>
						<DialogTitle>
							<Trans>Targeting note</Trans>
						</DialogTitle>
						<DialogDescription>
							{application.role} · {application.company}
						</DialogDescription>
					</DialogHeader>
					<div className="min-w-0 text-sm text-ink-2 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-ink [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-ink [&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-ink">
						<AssistantMarkdown text={notes} literalHtml />
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
