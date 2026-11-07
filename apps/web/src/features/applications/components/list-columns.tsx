import type { NextStepText } from "../next-step";
import type { Application } from "../types";
import type { ApplicationSortKey } from "@reactive-resume/schema/applications/filters";
import type { ListColumnId } from "@reactive-resume/schema/applications/layout";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { appliedDate } from "../sort";
import { getStageColor, getStageLabel } from "../stages";
import { BuildStatusControl } from "./build-status";
import { formatRelativeTime } from "@/libs/locale";

export type CellContext = { application: Application; next: NextStepText; locale: string };

type ListColumnDefinition = {
	label: () => string;
	/** The sort its heading picks; none for the columns that don't sort. */
	sort?: ApplicationSortKey;
	/** Above the row's open overlay, for cells with their own controls. */
	interactive?: boolean;
	cell: (context: CellContext) => ReactNode;
};

const blank = <span className="text-ink-3">—</span>;

/** "Oct 25", with the year when it isn't this year's. */
export function formatShortDate(value: Date | string, locale: string) {
	const date = new Date(value);
	const sameYear = date.getFullYear() === new Date().getFullYear();
	return date.toLocaleDateString(locale, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

const percent = (value: number | null, title: string) =>
	value === null ? (
		blank
	) : (
		<span title={title} className="text-[13px] text-ink-2 tabular-nums">
			{value}%
		</span>
	);

const text = (value: string | null | undefined) =>
	value ? <span className="block truncate text-[13px] text-ink-2">{value}</span> : blank;

const date = (value: Date | string | null, locale: string) =>
	value === null ? (
		blank
	) : (
		<span className="text-[13px] text-ink-2 tabular-nums">{formatShortDate(value, locale)}</span>
	);

/** Every column the List can show after Role: its heading, the sort its heading picks and its cell. */
export const LIST_COLUMNS: Record<ListColumnId, ListColumnDefinition> = {
	next: {
		label: () => t`Next step`,
		sort: "next",
		cell: ({ next }) => (
			<span
				className={cn(
					"flex min-w-0 items-center gap-1.5",
					next.tone === "warn" ? "text-warn-text" : next.tone === "muted" ? "text-ink-3" : "text-ink-2",
				)}
			>
				<Icon name={next.icon} size={16} className="shrink-0" />
				<span className="truncate">{next.title}</span>
			</span>
		),
	},
	fit: {
		label: () => t`Fit`,
		sort: "fit",
		cell: ({ application }) => percent(application.searchFit, t`Search fit`),
	},
	tfit: {
		label: () => t`Targeting fit`,
		sort: "tfit",
		cell: ({ application }) => percent(application.targetingFit, t`Targeting fit`),
	},
	build: {
		label: () => t`Build`,
		interactive: true,
		cell: ({ application }) => <BuildStatusControl application={application} />,
	},
	stage: {
		label: () => t`Stage`,
		cell: ({ application }) => (
			<span className="flex items-center gap-1.5 text-ink-2">
				<span
					aria-hidden="true"
					className="size-2 shrink-0 rounded-full"
					style={{ background: getStageColor(application.status) }}
				/>
				<span className="truncate">{getStageLabel(application.status)}</span>
			</span>
		),
	},
	sent: {
		label: () => t`Sent`,
		cell: ({ application }) =>
			application.resumeId || application.coverLetterId ? (
				<span className="flex items-center gap-1 text-ink-2">
					{application.resumeId && <Icon name="file-text" size={18} aria-label={t`Resume`} />}
					{application.coverLetterId && <Icon name="envelope-simple" size={18} aria-label={t`Cover letter`} />}
				</span>
			) : (
				<span className={cn("text-xs", application.status === "saved" ? "text-ink-3" : "text-warn-text")}>
					<Trans>None</Trans>
				</span>
			),
	},
	foundBy: {
		label: () => t`Found by`,
		cell: ({ application }) => text(application.foundBy),
	},
	source: {
		label: () => t`Found on`,
		cell: ({ application }) => text(application.source),
	},
	lane: {
		label: () => t`Lane`,
		cell: ({ application }) =>
			text([application.targetingPrimaryLane, application.targetingSecondaryLane].filter(Boolean).join(", ")),
	},
	salary: {
		label: () => t`Salary`,
		cell: ({ application }) => text(application.salary),
	},
	tags: {
		label: () => t`Tags`,
		cell: ({ application }) =>
			application.tags.length === 0 ? (
				blank
			) : (
				<span className="flex gap-1 overflow-hidden">
					{application.tags.map((tag) => (
						<span key={tag} className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[11.5px] text-ink-2">
							{tag}
						</span>
					))}
				</span>
			),
	},
	followUp: {
		label: () => t`Follow-up`,
		cell: ({ application, locale }) => date(application.followUpAt, locale),
	},
	applied: {
		label: () => t`Applied`,
		sort: "applied",
		cell: ({ application, locale }) => date(appliedDate(application), locale),
	},
	added: {
		label: () => t`Added`,
		sort: "added",
		cell: ({ application, locale }) => date(application.createdAt, locale),
	},
	updated: {
		label: () => t`Updated`,
		sort: "updated",
		cell: ({ application, locale }) => (
			<span className="text-xs whitespace-nowrap text-ink-3">{formatRelativeTime(application.updatedAt, locale)}</span>
		),
	},
};
