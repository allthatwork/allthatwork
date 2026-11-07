import type { Application } from "../types";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { ApplicationSort, ApplicationSortKey } from "@reactive-resume/schema/applications/filters";
import type { ListColumnId } from "@reactive-resume/schema/applications/layout";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Plural, Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, m } from "motion/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { defaultSortDirection } from "@reactive-resume/schema/applications/filters";
import { LIST_COLUMN_MAX_WIDTH, LIST_COLUMN_WIDTHS, ROLE_MIN_WIDTH } from "@reactive-resume/schema/applications/layout";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { describeNextStep, getNextStep, useNoReplyDays } from "../next-step";
import { sortApplications } from "../sort";
import { CLOSED_REASONS, getClosedReasonLabel, getStageColor, getStageLabel, LIST_ORDER, PIPELINE } from "../stages";
import { useInvalidateApplications } from "../use-application-actions";
import { StaleNote } from "./application-card";
import { LIST_COLUMNS } from "./list-columns";
import { useConfirm } from "@/hooks/use-confirm";
import { D2, EASE, EXIT } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

/** The checkbox column; Role takes what the others leave. */
const CHECK_WIDTH = 40;

type ShownColumn = { id: ListColumnId; width: number };

type ListViewProps = {
	applications: Application[];
	/** The stages the filters show; a group each. */
	stages: readonly ApplicationStatus[];
	/** Rows changed since the last filter change that no longer match, with the group they showed in. */
	stale?: ReadonlyMap<string, ApplicationStatus>;
	sort: ApplicationSort;
	onSortChange: (sort: ApplicationSort) => void;
	/** The columns after Role, in order, with their widths. */
	columns: readonly ShownColumn[];
	/** Saves a column's width; null takes it back to its starting width. */
	onColumnResize: (id: ListColumnId, width: number | null) => void;
	selectedId: string | null;
	onOpen: (application: Application) => void;
};

const NO_STALE: ReadonlyMap<string, ApplicationStatus> = new Map();

/** A changed row whose stage is filtered out stays in the group it was in until the filters change. */
const groupFor = (
	application: Application,
	stages: readonly ApplicationStatus[],
	stale: ReadonlyMap<string, ApplicationStatus>,
) => (stages.includes(application.status) ? application.status : (stale.get(application.id) ?? application.status));

/**
 * Applications grouped by stage in the order that needs you first (Interview, Offer, Screening, Applied, Saved, then
 * Closed), for the stages the filters show, sorted within each group. Role comes first and takes the width the other
 * columns leave; the rest are the account's choice, each with its own width, dragged by the line between two headings.
 * Groups collapse, sortable headings sort, and row checkboxes select for bulk moves, tags, closing and deleting.
 * Phones get two-line rows.
 */
export function ApplicationList({
	applications,
	stages,
	stale = NO_STALE,
	sort,
	onSortChange,
	columns,
	onColumnResize,
	selectedId,
	onOpen,
}: ListViewProps) {
	const phone = useBreakpoint() === "mobile";
	const [collapsed, setCollapsed] = useState<ReadonlySet<ApplicationStatus>>(new Set());
	const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
	// The column being dragged and its width so far; it's saved when the drag ends.
	const [resizing, setResizing] = useState<ShownColumn | null>(null);
	const wrapRef = useRef<HTMLDivElement>(null);
	const guideRef = useRef<HTMLDivElement>(null);

	// Selections only cover what's on screen.
	const checkedIds = applications
		.filter((application) => {
			const group = groupFor(application, stages, stale);
			return checked.has(application.id) && stages.includes(group) && !collapsed.has(group);
		})
		.map((application) => application.id);
	if (checkedIds.length !== checked.size) setChecked(new Set(checkedIds));

	const groups = useMemo(
		() =>
			LIST_ORDER.filter((status) => stages.includes(status))
				.map((status) => ({
					status,
					rows: sortApplications(
						applications.filter((application) => groupFor(application, stages, stale) === status),
						sort,
					),
				}))
				.filter((group) => group.rows.length > 0),
		[applications, stages, stale, sort],
	);

	const shown = columns.map((column) => (resizing?.id === column.id ? resizing : column));
	const minWidth = CHECK_WIDTH + ROLE_MIN_WIDTH + shown.reduce((total, column) => total + column.width, 0);

	// While dragging, a line runs down the whole table at the column's start edge.
	useLayoutEffect(() => {
		const guide = guideRef.current;
		const heading = resizing && wrapRef.current?.querySelector<HTMLElement>(`th[data-column="${resizing.id}"]`);
		if (!guide || !heading) return;
		const rtl = getComputedStyle(heading).direction === "rtl";
		guide.style.left = `${heading.offsetLeft + (rtl ? heading.offsetWidth : 0)}px`;
	}, [resizing]);

	/** The widest a column can get while Role keeps its minimum. */
	const maxWidthFor = (id: ListColumnId) => {
		const available = wrapRef.current?.clientWidth ?? 0;
		const others = columns.reduce((total, column) => total + (column.id === id ? 0 : column.width), 0);
		return Math.max(
			LIST_COLUMN_WIDTHS[id].min,
			Math.min(LIST_COLUMN_MAX_WIDTH, available - CHECK_WIDTH - ROLE_MIN_WIDTH - others),
		);
	};

	const toggleGroup = (status: ApplicationStatus) =>
		setCollapsed((current) => {
			const next = new Set(current);
			if (next.has(status)) next.delete(status);
			else next.add(status);
			return next;
		});

	const toggleRow = (id: string) =>
		setChecked((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	const sortBy = (key: ApplicationSortKey) =>
		onSortChange(
			sort.sort === key
				? { sort: key, dir: sort.dir === "asc" ? "desc" : "asc" }
				: { sort: key, dir: defaultSortDirection(key) },
		);

	const heading = (key: ApplicationSortKey | undefined, label: string) =>
		key ? (
			<button
				type="button"
				onClick={() => sortBy(key)}
				className="inline-flex h-9 max-w-full items-center gap-1 rounded-md transition-colors hover:text-ink"
			>
				<span className="truncate">{label}</span>
				{sort.sort === key && (
					<Icon name={sort.dir === "asc" ? "arrow-up" : "arrow-down"} size={14} className="shrink-0" />
				)}
			</button>
		) : (
			<span className="block truncate">{label}</span>
		);

	const ariaSort = (key: ApplicationSortKey | undefined) =>
		key && sort.sort === key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined;

	return (
		<div className="grid min-w-0 content-start gap-3">
			<div ref={wrapRef} className="relative min-w-0 overflow-x-auto">
				{/* Phones keep the automatic layout: their rows are one cell, and a fixed layout would split them by the group headings' span. */}
				<table
					className={cn("w-full border-collapse text-sm", !phone && "table-fixed")}
					style={phone ? undefined : { minWidth }}
				>
					{!phone && (
						<colgroup>
							<col style={{ width: CHECK_WIDTH }} />
							<col />
							{shown.map((column) => (
								<col key={column.id} style={{ width: column.width }} />
							))}
						</colgroup>
					)}
					{!phone && (
						<thead>
							<tr className="group/head border-b border-line text-xs text-ink-3">
								<th scope="col" className="ps-3">
									<span className="sr-only">
										<Trans>Select</Trans>
									</span>
								</th>
								<th scope="col" aria-sort={ariaSort("role")} className="px-2 text-start font-medium">
									{heading("role", t`Role`)}
								</th>
								{shown.map((column) => {
									const definition = LIST_COLUMNS[column.id];
									const label = definition.label();
									return (
										<th
											key={column.id}
											scope="col"
											data-column={column.id}
											aria-sort={ariaSort(definition.sort)}
											className="relative px-2 text-start font-medium"
										>
											<ColumnResizeHandle
												label={label}
												width={column.width}
												min={LIST_COLUMN_WIDTHS[column.id].min}
												active={resizing?.id === column.id}
												maxWidth={() => maxWidthFor(column.id)}
												onResize={(width) => setResizing({ id: column.id, width })}
												onCommit={(width) => {
													setResizing(null);
													onColumnResize(column.id, width);
												}}
												onCancel={() => setResizing(null)}
												onReset={() => onColumnResize(column.id, null)}
											/>
											{heading(definition.sort, label)}
										</th>
									);
								})}
							</tr>
						</thead>
					)}

					{groups.map(({ status, rows }) => {
						const open = !collapsed.has(status);
						const groupId = `applications-group-${status}`;
						return (
							<tbody key={status} aria-labelledby={groupId}>
								<tr>
									<th scope="colgroup" colSpan={phone ? 1 : shown.length + 2} className="pt-3 text-start">
										<button
											type="button"
											id={groupId}
											aria-expanded={open}
											onClick={() => toggleGroup(status)}
											className="flex h-9 items-center gap-2 rounded-md px-1.5 text-sm font-semibold transition-colors hover:bg-hover"
										>
											<Icon
												name="caret-right"
												size={18}
												className={cn("text-ink-3 transition-transform duration-standard", open && "rotate-90")}
											/>
											<span
												aria-hidden="true"
												className="size-2 rounded-full"
												style={{ background: getStageColor(status) }}
											/>
											{getStageLabel(status)}
											<span className="font-mono text-xs font-normal text-ink-3">{rows.length}</span>
										</button>
									</th>
								</tr>
								{open &&
									rows.map((application) => (
										<ApplicationRow
											key={application.id}
											application={application}
											columns={shown}
											phone={phone}
											selected={application.id === selectedId}
											stale={stale.has(application.id)}
											checked={checked.has(application.id)}
											onCheck={() => toggleRow(application.id)}
											onOpen={() => onOpen(application)}
										/>
									))}
							</tbody>
						);
					})}
				</table>
				{resizing && (
					<div
						ref={guideRef}
						aria-hidden="true"
						className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-accent"
					/>
				)}
			</div>

			{/* The bulk bar rises from the bottom edge and floats over the list, so the rows never move. */}
			<AnimatePresence>
				{checkedIds.length > 0 && (
					<m.div
						key="bulk-bar"
						initial={{ opacity: 0, transform: "translateY(100%)" }}
						animate={{ opacity: 1, transform: "translateY(0%)" }}
						exit={{ opacity: 0, transform: "translateY(100%)", transition: { duration: D2 * EXIT, ease: EASE } }}
						transition={{ duration: D2, ease: EASE }}
						className="sticky bottom-4 z-20 justify-self-center max-sm:bottom-[calc(69px+env(safe-area-inset-bottom))]"
					>
						<BulkBar ids={checkedIds} onDone={() => setChecked(new Set())} />
					</m.div>
				)}
			</AnimatePresence>
		</div>
	);
}

type ColumnResizeHandleProps = {
	label: string;
	width: number;
	min: number;
	active: boolean;
	/** Read when a drag starts or a key is pressed: the widest the column can get while Role keeps its minimum. */
	maxWidth: () => number;
	/** The width while dragging. */
	onResize: (width: number) => void;
	/** The width to save: at the end of a drag, or on each arrow key. */
	onCommit: (width: number) => void;
	onCancel: () => void;
	/** Double-click: back to the starting width. */
	onReset: () => void;
};

/**
 * The line on a heading's start edge. It follows the pointer: the column it starts gets wider or narrower and Role, on
 * the far side, takes up the difference. Arrow keys move it 8px (Shift for 32px), and a double-click resets the column.
 */
function ColumnResizeHandle({
	label,
	width,
	min,
	active,
	maxWidth,
	onResize,
	onCommit,
	onCancel,
	onReset,
}: ColumnResizeHandleProps) {
	const drag = useRef<{ x: number; width: number; sign: number; max: number } | null>(null);
	const sign = (element: HTMLElement) => (getComputedStyle(element).direction === "rtl" ? -1 : 1);
	const widthAt = (clientX: number) => {
		const start = drag.current;
		if (!start) return width;
		return Math.min(start.max, Math.max(min, Math.round(start.width - start.sign * (clientX - start.x))));
	};

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label={t`Resize ${label}`}
			aria-valuenow={width}
			aria-valuemin={min}
			aria-valuemax={LIST_COLUMN_MAX_WIDTH}
			tabIndex={0}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				// A column already wider than the room left (the table scrolls sideways) can still be narrowed, not grown.
				drag.current = { x: event.clientX, width, sign: sign(event.currentTarget), max: Math.max(width, maxWidth()) };
				onResize(width);
			}}
			onPointerMove={(event) => {
				if (drag.current) onResize(widthAt(event.clientX));
			}}
			onPointerUp={(event) => {
				const start = drag.current;
				if (!start) return;
				const next = widthAt(event.clientX);
				drag.current = null;
				// A click without a drag (or the first click of a double-click) changes nothing.
				if (next === start.width) onCancel();
				else onCommit(next);
			}}
			onPointerCancel={() => {
				drag.current = null;
				onCancel();
			}}
			onDoubleClick={onReset}
			onKeyDown={(event) => {
				if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
				event.preventDefault();
				// The line moves with the arrow, so the column grows when it moves away from it.
				const toward = event.key === "ArrowLeft" ? 1 : -1;
				const step = event.shiftKey ? 32 : 8;
				onCommit(
					Math.min(Math.max(width, maxWidth()), Math.max(min, width + toward * sign(event.currentTarget) * step)),
				);
			}}
			className={cn(
				"absolute inset-y-0 -start-1.5 z-10 w-3 cursor-col-resize touch-none outline-none",
				"after:absolute after:inset-y-2 after:start-[5px] after:w-0.5 after:rounded-full after:transition-colors after:duration-quick",
				"group-hover/head:after:bg-line-2 hover:after:inset-y-1 hover:after:bg-accent focus-visible:after:inset-y-1 focus-visible:after:bg-accent",
				active && "after:inset-y-1 after:bg-accent",
			)}
		/>
	);
}

type ApplicationRowProps = {
	application: Application;
	columns: readonly ShownColumn[];
	phone: boolean;
	selected: boolean;
	/** Changed and no longer matching the filters: faded, with a note under the company. */
	stale: boolean;
	checked: boolean;
	onCheck: () => void;
	onOpen: () => void;
};

function ApplicationRow({
	application,
	columns,
	phone,
	selected,
	stale,
	checked,
	onCheck,
	onOpen,
}: ApplicationRowProps) {
	const { i18n } = useLingui();
	const noReplyDays = useNoReplyDays();
	const next = describeNextStep(getNextStep(application, { noReplyDays }), application, i18n.locale);

	const fade = stale && "opacity-55";
	const initial = (
		<span
			aria-hidden="true"
			className={cn(
				"grid size-8 shrink-0 place-items-center rounded-[7px] bg-sunken text-[13px] font-semibold text-ink-2",
				fade,
			)}
		>
			{application.company.slice(0, 1).toUpperCase()}
		</span>
	);

	const openButton = (
		<button type="button" onClick={onOpen} className="grid min-w-0 text-start after:absolute after:inset-0">
			<span className={cn("truncate font-medium", fade)}>{application.role}</span>
			<span className={cn("truncate text-xs text-ink-3", fade)}>
				{phone
					? `${application.company} · ${next.title}`
					: [application.company, application.location].filter(Boolean).join(" · ")}
			</span>
			{stale && <StaleNote />}
		</button>
	);

	if (phone) {
		return (
			<tr className={cn("relative border-b border-line", selected && "bg-accent-soft/50")}>
				<td className="py-2.5 ps-1">
					<div className="flex items-center gap-3">
						{initial}
						{openButton}
						<Icon name="caret-right" size={20} className="ms-auto shrink-0 text-ink-3" />
					</div>
				</td>
			</tr>
		);
	}

	const context = { application, next, locale: i18n.locale };

	return (
		<tr
			className={cn(
				"relative border-b border-line transition-colors duration-quick hover:bg-hover",
				selected && "bg-accent-soft/50",
			)}
		>
			<td className="relative z-10 ps-3">
				<Checkbox
					checked={checked}
					onCheckedChange={onCheck}
					aria-label={t`Select ${application.role} at ${application.company}`}
				/>
			</td>
			<td className="py-2 pe-2">
				<div className="flex min-w-0 items-center gap-3">
					{initial}
					{openButton}
				</div>
			</td>
			{columns.map((column) => {
				const definition = LIST_COLUMNS[column.id];
				return (
					<td
						key={column.id}
						className={cn("overflow-hidden px-2 whitespace-nowrap", definition.interactive && "relative z-10", fade)}
					>
						{definition.cell(context)}
					</td>
				);
			})}
		</tr>
	);
}

type BulkBarProps = { ids: string[]; onDone: () => void };

/** For the checked rows: move them, tag them, close them with a reason, or delete them (after asking). */
function BulkBar({ ids, onDone }: BulkBarProps) {
	const invalidate = useInvalidateApplications();
	const confirm = useConfirm();
	const [tag, setTag] = useState("");

	const bulkUpdate = useMutation({
		...orpc.applications.bulkUpdate.mutationOptions(),
		onSuccess: (result) => {
			invalidate();
			onDone();
			toast.add({ description: t`Updated ${result.updated}` });
		},
		onError: () => toast.add({ type: "error", description: t`Couldn't update the applications. Try again.` }),
	});
	const bulkDelete = useMutation({
		...orpc.applications.bulkDelete.mutationOptions(),
		onSuccess: (result) => {
			invalidate();
			onDone();
			toast.add({ description: t`Deleted ${result.deleted}` });
		},
		onError: () => toast.add({ type: "error", description: t`Couldn't delete the applications. Try again.` }),
	});

	return (
		<div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-ink px-3 py-2 text-bg shadow-e3">
			<span className="me-1 text-sm font-semibold">
				<Plural value={ids.length} one="# selected" other="# selected" />
			</span>

			<DropdownMenu>
				<DropdownMenuTrigger render={<Button size="sm" variant="secondary" />}>
					<Icon name="arrow-right" size={16} />
					<Trans>Move to…</Trans>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start">
					{PIPELINE.map((status) => (
						<DropdownMenuItem key={status} onClick={() => bulkUpdate.mutate({ ids, status })}>
							<span aria-hidden="true" className="size-2 rounded-full" style={{ background: getStageColor(status) }} />
							{getStageLabel(status)}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>

			<Popover>
				<PopoverTrigger render={<Button size="sm" variant="secondary" />}>
					<Icon name="tag" size={16} />
					<Trans>Add tag</Trans>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-60 p-2">
					<form
						className="flex gap-1.5"
						onSubmit={(event) => {
							event.preventDefault();
							if (!tag.trim()) return;
							bulkUpdate.mutate({ ids, addTags: [tag.trim()] });
							setTag("");
						}}
					>
						<Input aria-label={t`Tag`} value={tag} onChange={(event) => setTag(event.target.value)} autoFocus />
						<Button size="sm" type="submit" disabled={!tag.trim()}>
							<Trans>Add</Trans>
						</Button>
					</form>
				</PopoverContent>
			</Popover>

			<DropdownMenu>
				<DropdownMenuTrigger render={<Button size="sm" variant="secondary" />}>
					<Trans>Close…</Trans>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start">
					{CLOSED_REASONS.map((reason) => (
						<DropdownMenuItem
							key={reason}
							onClick={() => bulkUpdate.mutate({ ids, status: "closed", closedReason: reason })}
						>
							{getClosedReasonLabel(reason)}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>

			<Button
				size="sm"
				variant="secondary"
				className="text-danger-text"
				onClick={async () => {
					const confirmed = await confirm(t`Delete ${ids.length} applications?`, {
						description: t`They and their timelines are deleted permanently. This can't be undone.`,
						confirmText: t`Delete`,
					});
					if (confirmed) bulkDelete.mutate({ ids });
				}}
			>
				<Trans>Delete…</Trans>
			</Button>

			<Button size="sm" variant="ghost" className="ms-auto text-bg hover:bg-bg/15" onClick={onDone}>
				<Trans>Clear</Trans>
			</Button>
		</div>
	);
}
