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
import { factLabelClassName, factRowClassName, SheetSection, TextButton } from "./sheet-parts";
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

/** A fact row of the sheet that only reads (`.kv`): the search's and the targeting's own numbers. */
function ReadOnlyFact({ label, children }: ReadOnlyFactProps) {
	return (
		<div className={factRowClassName}>
			<dt className={factLabelClassName}>{label}</dt>
			<dd className="min-w-0 truncate tabular-nums">{children}</dd>
		</div>
	);
}

const percent = (fit: number | null) => (fit === null ? "—" : `${fit}%`);

const assessedOn = (at: Date | string | null, locale: string) =>
	at ? new Date(at).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" }) : undefined;

type SearchSectionProps = { application: Application; locale: string };

/** What the job search made of the posting: its fit (the search's number, not editable here) and its notes. */
export function SearchSection({ application, locale }: SearchSectionProps) {
	return (
		<section aria-labelledby="application-search" className="grid">
			<SheetSection id="application-search" note={assessedOn(application.searchAt, locale)}>
				<Trans>Search</Trans>
			</SheetSection>
			<dl className="grid">
				<ReadOnlyFact label={t`Search fit`}>{percent(application.searchFit)}</ReadOnlyFact>
			</dl>
			<ApplicationNotes
				application={application}
				field="searchNotes"
				label={t`Search notes`}
				placeholder={t`What the search found: strengths, gaps, unknowns`}
				rows={application.searchNotes ? 6 : 2}
				renderLabel={(label, htmlFor) => (
					<label htmlFor={htmlFor} className="pt-3 pb-1.5 text-[13px]/[18px] font-medium text-ink-2">
						{label}
					</label>
				)}
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
		<div className={factRowClassName}>
			<dt className={factLabelClassName}>
				<label htmlFor={id} className="block leading-5">
					{label}
				</label>
			</dt>
			<dd className="relative flex min-w-0 items-center">
				<select
					id={id}
					value={value ?? ""}
					onChange={(event) => {
						const next = event.target.value || null;
						if (next !== value) onSave(next);
					}}
					className={cn(
						"h-8 w-full min-w-0 cursor-pointer appearance-none truncate rounded-xs bg-transparent pe-6 text-start hover:underline",
						!value && "text-ink-3",
					)}
				>
					<option value="">{t`None`}</option>
					{lanes.map((lane) => (
						<option key={lane} value={lane}>
							{lane}
						</option>
					))}
					{unlisted && <option value={value}>{t`${value} (not in Preferences)`}</option>}
				</select>
				<Icon
					name="caret-up-down"
					size={16}
					className="pointer-events-none absolute inset-e-0 top-1/2 -translate-y-1/2 text-ink-3"
				/>
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
		<div className="grid">
			<p className="pt-3 pb-1 text-[13px]/[18px] font-medium text-ink-2">
				<Trans>Reviewers · round {round}</Trans>
			</p>
			<ul className="grid">
				{latest.map((review) => (
					<li
						key={`${review.round}-${review.reviewer}`}
						className="flex min-h-[33px] min-w-0 items-center gap-3 border-b border-line text-[13px]/[18px] text-ink-3 last:border-0"
					>
						<span className="w-5 shrink-0 text-sm/5 font-medium text-ink">{review.reviewer}</span>
						<span className="w-12 shrink-0 text-sm/5 text-ink tabular-nums">
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
		<section aria-labelledby="application-targeting" className="grid">
			<SheetSection id="application-targeting" note={assessedOn(application.targetingAt, locale)}>
				<Trans>Targeting</Trans>
			</SheetSection>
			<dl className="grid">
				<ReadOnlyFact label={t`Targeting fit`}>{percent(application.targetingFit)}</ReadOnlyFact>
				<div className={factRowClassName}>
					<dt className={factLabelClassName}>
						<Trans>Build status</Trans>
					</dt>
					<dd className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
						<BuildStatusControl size="default" application={application} />
						{application.targetingBuildStatus === "failed" && (
							<TextButton onClick={() => save({ targetingBuildStatus: "build" })}>
								<Trans>Retry build</Trans>
							</TextButton>
						)}
						{application.targetingBuildStatus === "built" && (
							<TextButton onClick={() => save({ targetingBuildStatus: "build" })}>
								<Trans>Rebuild</Trans>
							</TextButton>
						)}
						{application.targetingBuildStatus === "building" && (
							<TextButton onClick={() => save({ targetingBuildStatus: null })}>
								<Trans>Cancel</Trans>
							</TextButton>
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
			<Reviews reviews={application.targetingReviews} />
			<Link
				to="/dashboard/career/knowledge/preferences"
				className="mt-2 w-fit rounded-xs text-[13px]/[18px] font-medium text-accent-text hover:underline"
			>
				{lanes.length ? <Trans>Edit lanes in Preferences</Trans> : <Trans>Add your lanes in Preferences</Trans>}
			</Link>
			{targetingNotes && <TargetingNoteButton className="mt-3" application={application} notes={targetingNotes} />}
		</section>
	);
}

type TargetingNoteButtonProps = {
	application: Pick<Application, "role" | "company">;
	notes: string;
	/** `link` inside a row's quiet lines; a small secondary button otherwise. */
	variant?: "secondary" | "link";
	className?: string;
};

/** Read the targeting note button and the wide dialog it opens, with the whole note as Markdown. */
export function TargetingNoteButton({
	application,
	notes,
	variant = "secondary",
	className,
}: TargetingNoteButtonProps) {
	const [reading, setReading] = useState(false);
	return (
		<>
			<Button
				variant={variant}
				size="sm"
				className={cn("w-fit", variant === "link" && "text-[13px]/[18px]", className)}
				onClick={() => setReading(true)}
			>
				{variant === "secondary" && <Icon name="file-text" size={16} />}
				<Trans>Read the targeting note</Trans>
			</Button>
			<Dialog open={reading} onOpenChange={setReading}>
				<DialogContent closeLabel={t`Close`} className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
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
