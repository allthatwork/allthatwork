import type { Application } from "@/features/applications/types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { cn } from "@reactive-resume/utils/style";
import { useCareerTime } from "../shared";
import { ListRow } from "@/components/calm/list-row";
import { BuildStatusControl } from "@/features/applications/components/build-status";
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
		<div className="grid min-w-0 content-start gap-0.5">
			<span className="text-[13px]/[18px] text-ink-3">{label}</span>
			<span className={cn("font-display text-[28px]/[34px] tabular-nums", value === null && "text-ink-3")}>
				{value === null ? "—" : `${value}%`}
			</span>
			{detail && <span className="truncate text-[13px]/[18px] text-ink-3">{detail}</span>}
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
		<div className="mb-5 grid grid-cols-2 gap-8 @lg:max-w-[560px]">
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

/**
 * Search and Targeting as rows of the Details list: what the job search and the resume targeting made of the posting.
 * Render inside a `List`.
 */
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
	const hasTargeting =
		application.targetingBuildStatus !== null ||
		application.targetingFit !== null ||
		lanes.length > 0 ||
		Boolean(application.targetingNotes);
	const fit = (value: number | null) =>
		value === null ? undefined : <span className="text-sm/5 font-medium text-ink tabular-nums">{value}%</span>;

	return (
		<>
			{hasSearch && (
				<ListRow
					title={t`Search`}
					subtitle={
						[found, application.searchAt && date(application.searchAt)].filter(Boolean).join(" · ") || undefined
					}
					wrap
					value={fit(application.searchFit)}
					detail={
						application.searchNotes && (
							<span className="flex flex-col items-start gap-1 pt-1">
								<span className={cn("whitespace-pre-wrap text-ink-2", !expanded && "line-clamp-5")}>
									{application.searchNotes}
								</span>
								<button
									type="button"
									onClick={() => setExpanded((value) => !value)}
									className="touch-target relative rounded-xs font-medium text-accent-text hover:underline"
								>
									{expanded ? <Trans>Show less</Trans> : <Trans>Show all</Trans>}
								</button>
							</span>
						)
					}
				/>
			)}

			{hasTargeting && (
				<ListRow
					title={t`Targeting`}
					subtitle={
						[lanes.join(" + "), application.targetingAt && date(application.targetingAt)].filter(Boolean).join(" · ") ||
						undefined
					}
					wrap
					value={fit(application.targetingFit)}
					trailing={<BuildStatusControl size="default" application={application} />}
					detail={
						(reviewers || application.targetingNotes) && (
							<span className="flex flex-col items-start gap-1">
								{reviewers && <span className="tabular-nums">{reviewers}</span>}
								{application.targetingNotes && (
									<TargetingNoteButton variant="link" application={application} notes={application.targetingNotes} />
								)}
							</span>
						)
					}
				/>
			)}
		</>
	);
}
