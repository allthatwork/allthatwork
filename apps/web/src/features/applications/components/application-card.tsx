import type { Application } from "../types";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { describeNextStep, getNextStep, useNoReplyDays } from "../next-step";
import { ApplicationActionsMenu } from "./application-actions-menu";
import { BuildStatusControl } from "./build-status";

type ApplicationCardProps = {
	application: Application;
	onClick?: () => void;
	/** The ⋯ menu (Move to…, Close…, Delete); cards dragged in the overlay go without. */
	withMenu?: boolean;
	dragging?: boolean;
	/** Changed since the last filter change and no longer matching: shown faded until the filters change. */
	stale?: boolean;
};

/** A board card: the company's initial, role and company, the next step (warn when it's overdue) and the search fit. */
export function ApplicationCard({
	application,
	onClick,
	withMenu = false,
	dragging = false,
	stale = false,
}: ApplicationCardProps) {
	const { i18n } = useLingui();
	const noReplyDays = useNoReplyDays();
	const next = describeNextStep(getNextStep(application, { noReplyDays }), application, i18n.locale);

	return (
		<div
			className={cn(
				"group relative grid gap-2 rounded-[10px] border border-line bg-surface p-3 shadow-e1 transition-[border-color,scale] duration-quick ease-enter hover:border-line-2 active:not-has-[[data-slot=button]:active]:scale-[0.98]",
				// The overlay card lifts as it's picked up and settles flat again while the drop animation flies it home.
				stale && "border-dashed",
				dragging &&
					"scale-[1.02] rotate-1 cursor-grabbing shadow-e3 transition-[rotate,scale,box-shadow] duration-quick ease-enter **:cursor-grabbing in-[.is-dropping]:scale-100 in-[.is-dropping]:rotate-0 in-[.is-dropping]:shadow-e1 starting:scale-100 starting:rotate-0 starting:shadow-e1",
			)}
		>
			<div className={cn("flex items-start gap-2.5", stale && "opacity-55")}>
				<span
					aria-hidden="true"
					className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-sunken text-xs font-semibold text-ink-2"
				>
					{application.company.slice(0, 1).toUpperCase()}
				</span>
				<button
					type="button"
					onClick={onClick}
					className="grid min-w-0 flex-1 text-start after:absolute after:inset-0 after:rounded-[10px]"
				>
					<span className="line-clamp-2 text-sm font-semibold">{application.role}</span>
					<span className="truncate text-xs text-ink-3">{application.company}</span>
				</button>
				{withMenu && <ApplicationActionsMenu application={application} className="relative z-10 -me-1.5 -mt-1.5" />}
			</div>
			{/* The next step keeps its full width: when it and the badges don't fit on one line, the badges wrap below. */}
			<div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs", stale && "opacity-55")}>
				<span
					className={cn(
						"flex max-w-full shrink-0 items-center gap-1.5",
						next.tone === "warn" ? "text-warn-text" : next.tone === "muted" ? "text-ink-3" : "text-ink-2",
					)}
				>
					<Icon name={next.icon} size={15} className="shrink-0" />
					<span className="min-w-0 truncate">{next.title}</span>
				</span>
				<span className="ms-auto grid shrink-0 grid-cols-[54px_62px] items-center gap-2">
					<span className="flex justify-end">
						{application.searchFit !== null && (
							<span
								title={t`Search fit`}
								aria-label={t`Search fit ${application.searchFit}%`}
								className="inline-flex w-full items-center justify-center gap-1 rounded bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink-2 tabular-nums"
							>
								<span className="font-normal text-ink-3">
									<Trans>Fit</Trans>
								</span>
								<span>{application.searchFit}%</span>
							</span>
						)}
					</span>
					<span className="flex justify-start">
						<BuildStatusControl application={application} className="relative z-10" />
					</span>
				</span>
			</div>
			{stale && <StaleNote />}
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
