import type { ApplicationSummary } from "../types";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { ApplicationSort, ApplicationSortKey } from "@reactive-resume/schema/applications/filters";
import type { ListColumnId } from "@reactive-resume/schema/applications/layout";
import type { MouseEvent } from "react";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { HotkeysProvider, useHotkeys } from "@tanstack/react-hotkeys";
import { useMutation } from "@tanstack/react-query";
import { memo, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { getInitials } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { getCategoryLane, getDisplayLane, getLaneLabel } from "../lanes";
import { describeNextStep, getNextStep, useNoReplyDays } from "../next-step";
import { offerHintFor, useOfferHints } from "../queries";
import { sortApplications } from "../sort";
import { getStageLabel, LIST_ORDER, PIPELINE } from "../stages";
import {
	useApplicationActions,
	useInvalidateApplications,
	useMoveWithUndo,
	useTrashWithUndo,
} from "../use-application-actions";
import { useApplicationLanes } from "../use-application-lanes";
import { ClosedLaneItems, LaneDot } from "./application-actions-menu";
import { StaleNote } from "./application-card";
import { LIST_COLUMNS } from "./list-columns";
import { TagChips } from "./tag-chips";
import { IconTile } from "@/components/calm/list-row";
import { SelectionBar } from "@/components/calm/selection-bar";
import { StageDot } from "@/components/calm/stage-dot";
import { useCareerTime } from "@/features/career/shared";
import { orpc } from "@/libs/orpc/client";

/** "OH" for Orbital Health, "PC" for Parcel & Co., "LU" for Lumen: the one monogram rule people use too. */
export const companyInitials = getInitials;

/** The checkbox column; Role takes what the others leave. */
const CHECK_WIDTH = 40;

type ShownColumn = { id: ListColumnId; width: number };

type ListViewProps = {
	applications: ApplicationSummary[];
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
	onOpen: (application: ApplicationSummary) => void;
	/** A tag chip filters the page's existing search, rather than starting a second filter state. */
	onTagSelect?: ((tag: string) => void) | undefined;
};

const NO_STALE: ReadonlyMap<string, ApplicationStatus> = new Map();

/** A changed row whose stage is filtered out stays in the group it was in until the filters change. */
const groupFor = (
	application: ApplicationSummary,
	stages: readonly ApplicationStatus[],
	stale: ReadonlyMap<string, ApplicationStatus>,
) => (stages.includes(application.status) ? application.status : (stale.get(application.id) ?? application.status));

/**
 * Applications grouped by stage in the order that needs you first (Interview, Offer, Screening, Applied, Saved, then
 * Closed), for the stages the filters show, sorted within each group. Role comes first and takes the width the other
 * columns leave; the rest are the account's choice, each with its own width, dragged by the line between two headings.
 * Groups collapse, sortable headings sort, and row checkboxes select for bulk moves, tags, closing and deleting. A
 * focused row takes keyboard triage (J and K to step, Enter to open, 1 to 5 to move, X to select, F for followed up).
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
	onTagSelect,
}: ListViewProps) {
	const phone = useBreakpoint() === "mobile";
	const { lanes, isPending: lanesPending, error: lanesError } = useApplicationLanes();
	const moveWithUndo = useMoveWithUndo();
	const { logFollowUp } = useApplicationActions();
	const rowButtons = useRef(new Map<string, HTMLButtonElement>());
	const restoreFocus = useRef<string | null>(null);
	const [collapsed, setCollapsed] = useState<ReadonlySet<ApplicationStatus>>(new Set());
	const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
	const [selectionBarSpace, setSelectionBarSpace] = useState(0);
	// The column being dragged and its width so far; it's saved when the drag ends.
	const [resizing, setResizing] = useState<ShownColumn | null>(null);
	const wrapRef = useRef<HTMLDivElement>(null);
	const guideRef = useRef<HTMLDivElement>(null);

	// Selections only cover what's on screen.
	const visible = applications.filter((application) => {
		const group = groupFor(application, stages, stale);
		return stages.includes(group) && !collapsed.has(group);
	});
	const checkedIds = visible.filter((application) => checked.has(application.id)).map((application) => application.id);
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

	// Keyboard triage walks the rows as shown, skipping collapsed groups.
	const ordered = groups.flatMap(({ status, rows }) => (collapsed.has(status) ? [] : rows));
	const rowRef = (id: string, node: HTMLButtonElement | null) => {
		const previous = rowButtons.current.get(id);
		if (!node && previous === document.activeElement) restoreFocus.current = id;
		if (node) rowButtons.current.set(id, node);
		else rowButtons.current.delete(id);
	};
	useLayoutEffect(() => {
		const id = restoreFocus.current;
		restoreFocus.current = null;
		if (id && document.activeElement === document.body) rowButtons.current.get(id)?.focus();
	});
	const step = (id: string, direction: number) => {
		const index = ordered.findIndex((row) => row.id === id);
		if (index < 0) return;
		const next = ordered[Math.max(0, Math.min(ordered.length - 1, index + direction))];
		if (next) rowButtons.current.get(next.id)?.focus();
	};
	const move = (id: string, status: ApplicationStatus) => {
		const application = ordered.find((row) => row.id === id);
		if (!application || lanesPending || lanesError) return;
		const lane = getCategoryLane(lanes, status);
		if (getDisplayLane(lanes, application).id === lane.id) return;
		moveWithUndo({ applications: [application], lane, description: t`Moved to ${getLaneLabel(lane)}` });
	};
	const followedUp = (id: string) => {
		const application = ordered.find((row) => row.id === id);
		if (!application || application.status === "saved" || application.status === "closed" || logFollowUp.isPending)
			return;
		logFollowUp.mutate({ id });
	};

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
		<div
			className="grid min-w-0 content-start gap-3"
			style={{ paddingBottom: checkedIds.length ? selectionBarSpace : undefined }}
		>
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
									<Checkbox
										checked={visible.length > 0 && checkedIds.length === visible.length}
										indeterminate={checkedIds.length > 0 && checkedIds.length < visible.length}
										disabled={visible.length === 0}
										onCheckedChange={(on) =>
											setChecked(on ? new Set(visible.map((application) => application.id)) : new Set())
										}
										aria-label={t`Select all visible applications`}
									/>
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
											<StageDot status={status} />
											<span className="font-mono text-xs font-medium text-ink-3">{rows.length}</span>
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
											onCheck={toggleRow}
											onOpen={onOpen}
											onTagSelect={onTagSelect}
											rowRef={rowRef}
											onStep={step}
											onMove={move}
											onFollowUp={followedUp}
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

			{/* The bar floats over the list from the first tick to the last, so the rows never move; the list's foot keeps
			    the last rows clear of it. */}
			{checkedIds.length > 0 && (
				<BulkBar
					ids={checkedIds}
					total={visible.length}
					onSelectAll={() => setChecked(new Set(visible.map((application) => application.id)))}
					onDone={() => setChecked(new Set())}
					onHeight={setSelectionBarSpace}
				/>
			)}
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

/** Keeps a click on a cell's own control from opening the row. */
const stopClick = (event: MouseEvent) => event.stopPropagation();

type ApplicationRowProps = {
	application: ApplicationSummary;
	columns: readonly ShownColumn[];
	phone: boolean;
	selected: boolean;
	/** Changed and no longer matching the filters: faded, with a note under the company. */
	stale: boolean;
	checked: boolean;
	rowRef: (id: string, node: HTMLButtonElement | null) => void;
	onStep: (id: string, direction: number) => void;
	onMove: (id: string, status: ApplicationStatus) => void;
	onFollowUp: (id: string) => void;
	onCheck: (id: string) => void;
	onOpen: (application: ApplicationSummary) => void;
	onTagSelect?: ((tag: string) => void) | undefined;
};

// Memoized with id-taking callbacks, so one row's change doesn't re-render the other rows. The whole row opens the
// application (a click handler, not a stretched overlay, which Safari let capture clicks across the page); cells with
// their own controls stop the click.
const ApplicationRow = memo(function ApplicationRow({
	application,
	columns,
	phone,
	selected,
	stale,
	checked,
	rowRef,
	onStep,
	onMove,
	onFollowUp,
	onCheck,
	onOpen,
	onTagSelect,
}: ApplicationRowProps) {
	const openRef = useRef<HTMLButtonElement>(null);
	useHotkeys(
		[
			{ hotkey: "J" as const, callback: () => onStep(application.id, 1), meta: { name: t`Next application` } },
			{ hotkey: "K" as const, callback: () => onStep(application.id, -1), meta: { name: t`Previous application` } },
			{ hotkey: "Enter" as const, callback: () => onOpen(application), meta: { name: t`Open application` } },
			{ hotkey: "X" as const, callback: () => onCheck(application.id), meta: { name: t`Toggle selection` } },
			{ hotkey: "F" as const, callback: () => onFollowUp(application.id), meta: { name: t`Followed up` } },
			...PIPELINE.map((status, index) => ({
				hotkey: `${index + 1}` as "1" | "2" | "3" | "4" | "5",
				callback: () => onMove(application.id, status),
				meta: { name: t`Moved to ${getStageLabel(status)}` },
			})),
		].map(({ callback, meta, ...binding }) => ({
			...binding,
			options: { meta },
			callback: (event: KeyboardEvent) => {
				if (
					!event.repeat &&
					!event.isComposing &&
					event.keyCode !== 229 &&
					!event.ctrlKey &&
					!event.metaKey &&
					!event.altKey &&
					!event.shiftKey
				)
					callback();
			},
		})),
		{ target: openRef, requireReset: true, ignoreInputs: true },
	);
	const { i18n } = useLingui();
	const { timeZone } = useCareerTime();
	const noReplyDays = useNoReplyDays();
	const hints = useOfferHints(application.status === "offer");
	const next = describeNextStep(
		getNextStep(application, undefined, timeZone, offerHintFor(hints, application.id), noReplyDays),
		application,
		i18n.locale,
		timeZone,
	);

	const fade = stale && "opacity-55";
	const initial = (
		<IconTile aria-hidden="true" className={cn("shrink-0", fade)}>
			{companyInitials(application.company)}
		</IconTile>
	);

	const openButton = (
		<button
			type="button"
			ref={(node) => {
				openRef.current = node;
				rowRef(application.id, node);
			}}
			data-application-open
			aria-keyshortcuts="j k Enter 1 2 3 4 5 x f"
			className="focus-visible:outline-focus grid min-w-0 cursor-pointer rounded-sm text-start focus-visible:outline-2 focus-visible:outline-offset-4"
		>
			<span dir="auto" className={cn("truncate text-[15px]/[22px] font-medium text-ink", fade)}>
				{application.role}
			</span>
			{/* The company keeps its own direction; on phones the next step after it is interface text. */}
			{phone ? (
				<span className={cn("truncate text-[13px]/[18px] text-ink-3", fade)}>
					<bdi>{application.company}</bdi> · {next.title}
				</span>
			) : (
				<span dir="auto" className={cn("truncate text-[13px]/[18px] text-ink-3", fade)}>
					{[application.company, application.location].filter(Boolean).join(" · ")}
				</span>
			)}
			{stale && <StaleNote />}
		</button>
	);

	if (phone) {
		return (
			<tr
				data-application-id={application.id}
				onClick={() => onOpen(application)}
				className={cn("h-(--row) cursor-pointer border-b border-line", selected && "bg-accent-soft/50")}
			>
				<td className="py-2.5 ps-1">
					<div className="flex items-center gap-3">
						{initial}
						<div className="flex min-w-0 flex-1 flex-col gap-0.5">
							{openButton}
							<TagChips tags={application.tags} onSelect={onTagSelect} className="ms-0" />
						</div>
						<Icon name="caret-right" size={20} className="ms-auto shrink-0 text-ink-3" />
					</div>
				</td>
			</tr>
		);
	}

	const context = { application, next, locale: i18n.locale };

	return (
		<tr
			data-application-id={application.id}
			onClick={() => onOpen(application)}
			className={cn(
				"h-(--row) cursor-pointer border-b border-line transition-colors duration-quick hover:bg-hover",
				selected && "bg-accent-soft/50",
			)}
		>
			<td onClick={stopClick} className="cursor-default ps-3">
				<Checkbox
					checked={checked}
					onCheckedChange={() => onCheck(application.id)}
					aria-label={t`Select ${application.role} at ${application.company}`}
				/>
			</td>
			<td className="py-2 pe-2">
				<div className="flex min-w-0 items-center gap-3">
					{initial}
					<div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1.5">
						<div className="col-start-1 row-span-2 min-w-0">{openButton}</div>
						<TagChips
							tags={application.tags}
							onSelect={onTagSelect}
							className="col-start-2 row-start-2 ms-0 self-center"
						/>
					</div>
				</div>
			</td>
			{columns.map((column) => {
				const definition = LIST_COLUMNS[column.id];
				return (
					<td
						key={column.id}
						onClick={definition.interactive ? stopClick : undefined}
						className={cn("overflow-hidden px-2 whitespace-nowrap", definition.interactive && "cursor-default", fade)}
					>
						{definition.cell(context)}
					</td>
				);
			})}
		</tr>
	);
});

// A bar button keeps its hover look while its menu is open. Menus open 14px above the bar's own edge.
const openTrigger = "data-popup-open:bg-hover data-popup-open:text-ink";
const above = { side: "top", align: "start", sideOffset: 14, alignOffset: -4 } as const;

type BulkBarProps = {
	ids: string[];
	total: number;
	onSelectAll: () => void;
	onDone: () => void;
	/** The bar's height and margin, so the list keeps its last rows clear of it. */
	onHeight: (height: number) => void;
};

/** For the checked rows: tag them, or move them, close them or move them to Trash, each at once with Undo. */
function BulkBar({ ids, total, onSelectAll, onDone, onHeight }: BulkBarProps) {
	const scope = `applications-bulk-${useId()}`;
	const invalidate = useInvalidateApplications();
	const moveWithUndo = useMoveWithUndo();
	const trashWithUndo = useTrashWithUndo();
	const rows = ids.map((id) => ({ id }));
	const { lanes, active } = useApplicationLanes();
	const [tag, setTag] = useState("");
	const count = ids.length;

	const bulkUpdate = useMutation({
		...orpc.applications.bulkUpdate.mutationOptions(),
		onSuccess: (result) => {
			invalidate();
			onDone();
			toast.add({
				description: plural(result.updated, { one: "# application updated", other: "# applications updated" }),
			});
		},
		onError: () => toast.add({ type: "error", description: t`Couldn't update the applications. Try again.` }),
	});
	const disabled = count > 200 || bulkUpdate.isPending;
	const barRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const bar = barRef.current;
		if (!bar) return;
		const observer = new ResizeObserver(() => onHeight(bar.offsetHeight + 48));
		observer.observe(bar);
		return () => {
			observer.disconnect();
			onHeight(0);
		};
	}, [onHeight]);

	return (
		<SelectionBar
			ref={barRef}
			label={plural(count, { one: "# application selected", other: "# applications selected" })}
			count={count}
			total={total}
			onSelectAll={onSelectAll}
			onClear={onDone}
			className="fixed max-sm:bottom-[calc(var(--app-tabbar,0px)+16px)] sm:start-[calc(50%+32px)] lg:start-[calc(50%+var(--app-sidebar)/2)]"
		>
			{count > 200 && (
				<span role="status" className="px-2 text-sm text-warn-text">
					<Trans>Choose up to 200 applications per bulk action.</Trans>
				</span>
			)}

			<Popover>
				<PopoverTrigger render={<Button size="sm" variant="ghost" disabled={disabled} className={openTrigger} />}>
					<Icon name="tag" />
					<Trans>Tags…</Trans>
				</PopoverTrigger>
				<PopoverContent {...above} className="grid w-60 gap-2 p-3">
					<HotkeysProvider scope={`${scope}-tags`} exclusive>
						<p className="text-sm font-medium">
							{plural(count, { one: "Add a tag to # application", other: "Add a tag to # applications" })}
						</p>
						<form
							className="flex gap-2"
							onSubmit={(event) => {
								event.preventDefault();
								if (disabled || !tag.trim()) return;
								bulkUpdate.mutate({ ids, addTags: [tag.trim()] });
								setTag("");
							}}
						>
							<Input aria-label={t`Tag`} value={tag} onChange={(event) => setTag(event.target.value)} autoFocus />
							<Button type="submit" variant="secondary" disabled={disabled || !tag.trim()}>
								<Trans>Add</Trans>
							</Button>
						</form>
					</HotkeysProvider>
				</PopoverContent>
			</Popover>

			<DropdownMenu>
				<DropdownMenuTrigger render={<Button size="sm" variant="ghost" disabled={disabled} className={openTrigger} />}>
					<Icon name="arrow-right" />
					<Trans>Move to…</Trans>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					{...above}
					className="min-w-[190px]"
					aria-label={plural(count, { one: "Move # application to", other: "Move # applications to" })}
				>
					<HotkeysProvider scope={`${scope}-0`} exclusive>
						{active
							.filter((lane) => lane.category !== "closed")
							.map((lane) => (
								<DropdownMenuItem
									key={lane.id}
									onClick={() => {
										const label = getLaneLabel(lane);
										moveWithUndo({
											applications: rows,
											lane,
											description: plural(count, {
												one: `# application moved to ${label}`,
												other: `# applications moved to ${label}`,
											}),
										});
										onDone();
									}}
								>
									<LaneDot lane={lane} />
									{getLaneLabel(lane)}
								</DropdownMenuItem>
							))}
					</HotkeysProvider>
				</DropdownMenuContent>
			</DropdownMenu>

			<DropdownMenu>
				<DropdownMenuTrigger render={<Button size="sm" variant="ghost" disabled={disabled} className={openTrigger} />}>
					<Icon name="check-circle" />
					<Trans>Close…</Trans>
				</DropdownMenuTrigger>
				<DropdownMenuContent {...above} className="min-w-[190px]">
					<HotkeysProvider scope={`${scope}-1`} exclusive>
						<ClosedLaneItems
							lanes={active}
							onPick={(lane, reason) => {
								moveWithUndo({
									applications: rows,
									lane: lane ?? getCategoryLane(lanes, "closed"),
									closedReason: lane ? reason : (reason ?? null),
									description: plural(count, { one: "# application closed", other: "# applications closed" }),
								});
								onDone();
							}}
						/>
					</HotkeysProvider>
				</DropdownMenuContent>
			</DropdownMenu>

			<Button
				size="sm"
				variant="danger-text"
				disabled={disabled}
				onClick={() => {
					trashWithUndo(rows);
					onDone();
				}}
			>
				<Icon name="trash" />
				<Trans>Move to Trash</Trans>
			</Button>
		</SelectionBar>
	);
}
