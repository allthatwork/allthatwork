import type { ApplicationSummary } from "../types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { describeNextStepLine, getNextStep, useNoReplyDays } from "../next-step";
import { offerHintFor, useOfferHints } from "../queries";
import { ApplicationActionsMenu } from "./application-actions-menu";
import { BuildStatusControl } from "./build-status";
import { TagChips } from "./tag-chips";
import { useCareerTime, useNow } from "@/features/career/shared";

type ApplicationCardProps = {
	application: ApplicationSummary;
	/** Opens the application's details sheet. */
	onClick?: () => void;
	/** A tag chip filters the page's existing search. */
	onTagSelect?: ((tag: string) => void) | undefined;
	/** The ⋯ menu (Move to…, Close…, Move to Trash); cards dragged in the overlay go without. */
	withMenu?: boolean;
	dragging?: boolean;
	/** Changed since the last filter change and no longer matching: shown faded until the filters change. */
	stale?: boolean;
};

/**
 * A board card: the company with its place, the role, its tags, then the next step as the list writes it, with the
 * search fit and the resume build status. The card opens the details sheet; its menu shows on hover and on focus.
 */
export function ApplicationCard({
	application,
	onClick,
	onTagSelect,
	withMenu = false,
	dragging = false,
	stale = false,
}: ApplicationCardProps) {
	const { locale, timeZone } = useCareerTime();
	const now = useNow();
	const noReplyDays = useNoReplyDays();
	const hints = useOfferHints(application.status === "offer");
	const next = describeNextStepLine(
		getNextStep(application, now, timeZone, offerHintFor(hints, application.id), noReplyDays),
		application,
		locale,
		timeZone,
		now,
		"short",
	);
	// "Lisbon · Hybrid" has room in the list; a card names the place only.
	const place = application.location?.split(/\s*[·,]\s*/)[0];
	const title = (
		<span dir="auto" className="min-w-0 truncate text-sm font-medium text-ink">
			{application.company}
		</span>
	);

	return (
		<div
			data-application-id={application.id}
			className={cn(
				"group/row relative flex flex-col gap-1 rounded-lg border border-line bg-raised p-3 shadow-e1 transition-[border-color,scale] duration-quick ease-enter hover:border-line-2 active:not-has-[[data-slot=button]:active]:scale-[0.98]",
				stale && "border-dashed",
				// The overlay card lifts as it's picked up and settles flat again while the drop animation flies it home.
				dragging &&
					"scale-[1.02] -rotate-2 cursor-grabbing shadow-[var(--shadow-3),0_0_0_2px_var(--accent)] transition-[rotate,scale,box-shadow] duration-quick ease-enter **:cursor-grabbing in-[.is-dropping]:scale-100 in-[.is-dropping]:rotate-0 in-[.is-dropping]:shadow-e1 starting:scale-100 starting:rotate-0 starting:shadow-e1",
			)}
		>
			<div className={cn("flex flex-col gap-1", stale && "opacity-55")}>
				<span className="flex items-baseline justify-between gap-2">
					{dragging ? (
						title
					) : (
						<button
							type="button"
							data-application-open
							onClick={onClick}
							className="flex min-w-0 text-start after:absolute after:inset-0 after:rounded-lg"
						>
							{title}
						</button>
					)}
					{place && (
						<span dir="auto" className="shrink-0 text-[13px]/[18px] text-ink-3">
							{place}
						</span>
					)}
				</span>
				<span dir="auto" className="line-clamp-2 text-[13px]/[18px] text-ink-3">
					{application.role}
				</span>
				{/* Above the open button's stretched target, so filtering never opens the card. */}
				<TagChips tags={application.tags} onSelect={onTagSelect} className="relative z-10 ms-0" />
				<span className="mt-1.5 truncate text-[13px]/[18px] font-medium text-ink">{next.title}</span>
				{next.sub && <span className="truncate text-[13px]/[18px] text-ink-3">{next.sub}</span>}
				{/* The build control always shows (it queues a build), so this line is always there. */}
				<span className="mt-1 flex flex-wrap items-center gap-2 pe-8">
					{next.needsYou && (
						<Badge variant="warn">
							<Trans>Needs you</Trans>
						</Badge>
					)}
					{application.searchFit !== null && (
						<span
							title={t`Search fit`}
							aria-label={t`Search fit ${application.searchFit}%`}
							className="inline-flex items-center gap-1 rounded-sm bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink-2 tabular-nums"
						>
							<span className="font-normal text-ink-3">
								<Trans>Fit</Trans>
							</span>
							<span>{application.searchFit}%</span>
						</span>
					)}
					<BuildStatusControl application={application} className="relative z-10" />
				</span>
			</div>
			{stale && <StaleNote />}
			{withMenu && (
				<ApplicationActionsMenu
					application={application}
					className="absolute end-1.5 bottom-1.5 z-10 rounded-sm bg-raised opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-[[data-popup-open]]:opacity-100 pointer-coarse:opacity-100"
				/>
			)}
		</div>
	);
}

/** The line on a card or row that changed and no longer matches the filters. */
export function StaleNote() {
	return (
		<span className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
			<Icon name="funnel" size={14} className="shrink-0" />
			<Trans>Doesn't match the filters now</Trans>
		</span>
	);
}
