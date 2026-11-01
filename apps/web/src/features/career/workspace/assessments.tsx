import type { Application } from "@/features/applications/types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { cn } from "@reactive-resume/utils/style";
import { Eyebrow, useCareerTime } from "../shared";
import { TargetingNoteButton } from "@/features/applications/components/detail/assessments";

type AssessmentsProps = { application: Application };

/** "Search 84% · Targeting 80%" for the workspace header; nothing when neither fit is known. */
export function FitSummary({ application }: AssessmentsProps) {
	const fits = [
		application.searchFit !== null && t`Search ${application.searchFit}%`,
		application.targetingFit !== null && t`Targeting ${application.targetingFit}%`,
	].filter(Boolean);
	if (fits.length === 0) return null;
	return <span>· {fits.join(" · ")}</span>;
}

type FitScoreProps = { label: string; value: number | null; detail?: string | null };

function FitScore({ label, value, detail }: FitScoreProps) {
	return (
		<div className="grid min-w-0 gap-0.5 rounded-lg border border-line px-3 py-2">
			<span className="text-xs text-ink-3">{label}</span>
			<span className={cn("text-lg leading-6 font-semibold tabular-nums", value === null && "text-ink-3")}>
				{value === null ? "—" : `${value}%`}
			</span>
			{detail && <span className="truncate text-xs text-ink-3">{detail}</span>}
		</div>
	);
}

/** The search's and the targeting's fits above the Fit tab's own check, so all three read together. */
export function FitTabScores({ application }: AssessmentsProps) {
	const { date } = useCareerTime();
	if (application.searchFit === null && application.targetingFit === null) return null;
	const searchDetail = [application.foundBy, application.searchAt && date(application.searchAt)]
		.filter(Boolean)
		.join(" · ");
	const lanes = [application.targetingPrimaryLane, application.targetingSecondaryLane].filter(Boolean).join(" + ");
	return (
		<div className="mb-5 grid grid-cols-2 gap-2.5 @lg:max-w-[560px]">
			<FitScore label={t`Search fit`} value={application.searchFit} detail={searchDetail || null} />
			<FitScore label={t`Targeting fit`} value={application.targetingFit} detail={lanes || null} />
		</div>
	);
}

/** The latest review round in a line: "Round 2: B 72% · C 78% · A 35% · D skipped". */
function reviewSummary(reviews: Application["targetingReviews"]) {
	if (reviews.length === 0) return null;
	const round = Math.max(...reviews.map((review) => review.round));
	const scores = reviews
		.filter((review) => review.round === round)
		.map((review) =>
			review.status === "ran" && review.fit !== null
				? `${review.reviewer} ${review.fit}%`
				: t`${review.reviewer} skipped`,
		)
		.join(" · ");
	return t`Round ${round}: ${scores}`;
}

/** SEARCH and TARGETING in the context column: what the job search and the resume targeting made of the posting. */
export function AssessmentContext({ application }: AssessmentsProps) {
	const { date } = useCareerTime();
	const [expanded, setExpanded] = useState(false);
	const { foundBy, source } = application;
	const found =
		foundBy && source
			? t`Found by ${foundBy} on ${source}`
			: foundBy
				? t`Found by ${foundBy}`
				: source
					? t`Found on ${source}`
					: "";
	const lanes = [application.targetingPrimaryLane, application.targetingSecondaryLane].filter(Boolean);
	const reviewers = reviewSummary(application.targetingReviews);
	const hasSearch = application.searchFit !== null || Boolean(application.searchNotes) || Boolean(found);
	const hasTargeting = application.targetingFit !== null || lanes.length > 0 || Boolean(application.targetingNotes);

	return (
		<>
			{hasSearch && (
				<section className="grid gap-2">
					<Eyebrow>
						<Trans>Search</Trans>
						{application.searchAt && <> · {date(application.searchAt)}</>}
					</Eyebrow>
					<p className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink-2">
						{application.searchFit !== null && (
							<span className="font-semibold text-ink tabular-nums">{application.searchFit}%</span>
						)}
						{found && <span>{found}</span>}
					</p>
					{application.searchNotes && (
						<div className="grid justify-items-start gap-1">
							<p
								className={cn("text-[13px] leading-[19px] whitespace-pre-wrap text-ink-2", !expanded && "line-clamp-5")}
							>
								{application.searchNotes}
							</p>
							<button
								type="button"
								onClick={() => setExpanded((value) => !value)}
								className="text-xs text-ink-3 underline-offset-2 hover:text-ink-2 hover:underline"
							>
								{expanded ? <Trans>Show less</Trans> : <Trans>Show all</Trans>}
							</button>
						</div>
					)}
				</section>
			)}

			{hasTargeting && (
				<section className="grid gap-2">
					<Eyebrow>
						<Trans>Targeting</Trans>
						{application.targetingAt && <> · {date(application.targetingAt)}</>}
					</Eyebrow>
					<p className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink-2">
						{application.targetingFit !== null && (
							<span className="font-semibold text-ink tabular-nums">{application.targetingFit}%</span>
						)}
						{lanes.length > 0 && <span>{lanes.join(" + ")}</span>}
					</p>
					{reviewers && <p className="text-xs text-ink-3 tabular-nums">{reviewers}</p>}
					{application.targetingNotes && (
						<TargetingNoteButton application={application} notes={application.targetingNotes} />
					)}
				</section>
			)}
		</>
	);
}
