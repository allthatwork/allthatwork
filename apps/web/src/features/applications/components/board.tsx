import type { ApplicationSummary } from "../types";
import type { DndLabel } from "@/libs/dnd";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { ApplicationSort } from "@reactive-resume/schema/applications/filters";
import type { ReactNode, RefObject } from "react";
import {
	DndContext,
	DragOverlay,
	defaultDropAnimationSideEffects,
	PointerSensor,
	pointerWithin,
	useDndContext,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { APPLICATION_STATUSES } from "@reactive-resume/schema/applications/data";
import { BOARD_COLUMN_WIDTH, clampBoardColumnWidth } from "@reactive-resume/schema/applications/layout";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { cn } from "@reactive-resume/utils/style";
import { getCategoryLane } from "../lanes";
import { sortApplications } from "../sort";
import { CLOSED_REASONS, getClosedReasonLabel, getStageLabel } from "../stages";
import { useApplicationActions } from "../use-application-actions";
import { useApplicationLanes } from "../use-application-lanes";
import { ApplicationCard } from "./application-card";
import { StageDot } from "@/components/calm/stage-dot";
import { getEdgeFadeStyle, useScrollEdges } from "@/hooks/use-scroll-edges";
import { dndContextProps } from "@/libs/dnd";
import { DRAG_SETTLE } from "@/libs/motion";

type BoardProps = {
	applications: ApplicationSummary[];
	/** The stages the filters show; a column each, in pipeline order with Closed last. */
	stages: readonly ApplicationStatus[];
	/** Cards changed since the last filter change that no longer match, with the column they showed in. */
	stale?: ReadonlyMap<string, ApplicationStatus>;
	/** The order of the cards in each column. */
	sort: ApplicationSort;
	/** One width for every column once dragged; unset, they share the board evenly. */
	columnWidth?: number | undefined;
	/** Saves a dragged width; null goes back to sharing the board evenly. */
	onColumnWidthChange: (width: number | null) => void;
	onOpen: (application: ApplicationSummary) => void;
	onTagSelect?: ((tag: string) => void) | undefined;
	/** The + on the Saved column. */
	onSaveJob?: (() => void) | undefined;
};

/** The gap between columns (`gap-3`), for the resize line's position. */
const COLUMN_GAP = 12;

const NO_STALE: ReadonlyMap<string, ApplicationStatus> = new Map();

// While the overlay settles, the real card waits hidden in its new slot and the overlay's tilt eases off.
const dropSideEffects = defaultDropAnimationSideEffects({
	styles: { active: { opacity: "0" } },
	className: { dragOverlay: "is-dropping" },
});

/**
 * A column per stage the filters show. Dropping a card on a column moves it, with the same toast as the other ways to
 * change stage; each card's menu has Move to… for the keyboard. There's no column for a filtered-out stage to drop on.
 * Desktop and tablet only. The cards in each column follow the sort. The columns share the width evenly, at least 256px
 * each and never wider than with five showing, so a one-stage board keeps card-sized columns on the left, until the
 * line after any column is dragged: then every column takes that one width (256 to 640px), saved to the account.
 * Past the window's width the board scrolls sideways, with a fade on the side that has more. A drag shows both ends: a
 * dashed slot where the card was and a tinted one where it will land.
 */
export function ApplicationBoard({
	applications,
	stages: chosen,
	stale = NO_STALE,
	sort,
	columnWidth,
	onColumnWidthChange,
	onOpen,
	onTagSelect,
	onSaveJob,
}: BoardProps) {
	const { moveTo, close, update } = useApplicationActions();
	// The board draws the six stages; a move lands in the stage's default lane, as the server does.
	const { lanes } = useApplicationLanes();
	const reduceMotion = useReducedMotion();
	const [activeId, setActiveId] = useState<string | null>(null);
	const [closing, setClosing] = useState<ApplicationSummary | null>(null);
	// The list query publishes the optimistic move a task after the drop (TanStack Query notifies on a timeout), so
	// until it does the board shows the dropped card in its new column itself. Otherwise the card blinks back to its
	// old column for a frame, and the drop animation would fly there.
	const [pendingMove, setPendingMove] = useState<{ id: string; from: ApplicationStatus; to: ApplicationStatus } | null>(
		null,
	);

	// The query caught up, rolled back, failed, or the card went away: the override has done its job.
	const movedStatus = update.variables?.laneId
		? lanes.find((lane) => lane.id === update.variables?.laneId)?.category
		: update.variables?.status;
	if (
		pendingMove &&
		(applications.find((application) => application.id === pendingMove.id)?.status !== pendingMove.from ||
			(update.isError && update.variables?.id === pendingMove.id && movedStatus === pendingMove.to))
	) {
		setPendingMove(null);
	}
	const stages = APPLICATION_STATUSES.filter((stage) => chosen.includes(stage));
	// A changed card whose stage is filtered out stays in the column it was in until the filters change.
	const statusOf = (application: ApplicationSummary) => {
		if (pendingMove?.id === application.id) return pendingMove.to;
		if (stages.includes(application.status)) return application.status;
		return stale.get(application.id) ?? application.status;
	};

	// A small activation distance so a click still opens the detail sheet instead of starting a drag.
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

	const byStage = new Map<ApplicationStatus, ApplicationSummary[]>(stages.map((stage) => [stage, []]));
	for (const application of sortApplications(applications, sort)) byStage.get(statusOf(application))?.push(application);

	// The width while the line is dragged; it's saved when the drag ends.
	const [dragWidth, setDragWidth] = useState<number | null>(null);
	const width = dragWidth ?? columnWidth;

	const active = activeId ? applications.find((application) => application.id === activeId) : null;

	// A soft fade on the sides with columns past the edge; the Stage filter adds or removes columns.
	const scrollerRef = useRef<HTMLDivElement>(null);
	const edges = useScrollEdges(scrollerRef, stages.length);

	const onDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));

	const onDragEnd = (event: DragEndEvent) => {
		setActiveId(null);
		const target = event.over?.id as ApplicationStatus | undefined;
		const application = applications.find((item) => item.id === event.active.id);
		if (!target || !application || application.status === target) return;
		if (target === "closed") {
			setClosing(application);
			return;
		}
		// Same batched render as setActiveId(null): the card is already in its new column when the drop animation measures it.
		setPendingMove({ id: application.id, from: application.status, to: target });
		moveTo(application, getCategoryLane(lanes, target));
	};

	return (
		<DndContext
			{...dndContextProps(false)}
			sensors={sensors}
			collisionDetection={pointerWithin}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
		>
			<div ref={scrollerRef} style={getEdgeFadeStyle(edges)} className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-3">
				{stages.map((stage, index) => (
					<Column
						key={stage}
						stage={stage}
						applications={byStage.get(stage) ?? []}
						stale={stale}
						width={width}
						onOpen={onOpen}
						onTagSelect={onTagSelect}
						onSaveJob={stage === "saved" ? onSaveJob : undefined}
						handle={
							<BoardResizeHandle
								index={index}
								scroller={scrollerRef}
								width={width}
								resizing={dragWidth !== null}
								onResize={setDragWidth}
								onCommit={(next) => {
									setDragWidth(null);
									onColumnWidthChange(next);
								}}
								onCancel={() => setDragWidth(null)}
								onReset={() => onColumnWidthChange(null)}
							/>
						}
					/>
				))}
			</div>

			{/* The overlay settles into the card's new slot (or back where it came from); the drop itself shows at once, see pendingMove. */}
			<DragOverlay dropAnimation={reduceMotion ? null : { ...DRAG_SETTLE, sideEffects: dropSideEffects }}>
				{active ? <ApplicationCard application={active} dragging /> : null}
			</DragOverlay>
			<Dialog open={Boolean(closing)} onOpenChange={(open) => !open && setClosing(null)}>
				<DialogContent closeLabel={t`Close`}>
					<DialogHeader>
						<DialogTitle>
							<Trans>Mark as closed</Trans>
						</DialogTitle>
						<DialogDescription>
							{closing?.company} · {closing?.role}
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-2">
						{CLOSED_REASONS.map((reason) => (
							<Button
								key={reason}
								variant="secondary"
								onClick={() => {
									if (!closing) return;
									setPendingMove({ id: closing.id, from: closing.status, to: "closed" });
									close(closing, reason);
									setClosing(null);
								}}
							>
								{getClosedReasonLabel(reason)}
							</Button>
						))}
					</div>
				</DialogContent>
			</Dialog>
		</DndContext>
	);
}

// Cap the cards rendered per column so a stage with hundreds of applications doesn't mount hundreds of draggable
// nodes at once; the rest show in batches.
const COLUMN_PAGE_SIZE = 50;

type ColumnProps = {
	stage: ApplicationStatus;
	applications: ApplicationSummary[];
	stale: ReadonlyMap<string, ApplicationStatus>;
	/** The set width, or none to share the board evenly. */
	width: number | undefined;
	/** The resize line in the gap after the column. */
	handle: ReactNode;
	onOpen: (application: ApplicationSummary) => void;
	onTagSelect?: ((tag: string) => void) | undefined;
	onSaveJob?: (() => void) | undefined;
};

const slotClassName = "shrink-0 rounded-lg outline-1 -outline-offset-1 outline-dashed";

function Column({ stage, applications, stale, width, handle, onOpen, onTagSelect, onSaveJob }: ColumnProps) {
	const label = getStageLabel(stage);
	const { setNodeRef, isOver } = useDroppable({ id: stage, data: { label } satisfies DndLabel });
	const { active } = useDndContext();
	const [visible, setVisible] = useState(COLUMN_PAGE_SIZE);
	const shown = applications.slice(0, visible);
	const remaining = applications.length - shown.length;
	// The card would land here: a tinted slot of its own height waits at the end of the column.
	const landing = isOver && !!active && !applications.some((application) => application.id === active.id);

	return (
		<section
			aria-label={label}
			style={width === undefined ? undefined : { width }}
			className={cn(
				"relative flex flex-col rounded-lg bg-sunken dark:shadow-[inset_0_0_0_1px_var(--line)]",
				width === undefined ? "max-w-[calc((100%-48px)/5)] min-w-64 flex-1 basis-0" : "flex-none",
			)}
		>
			{handle}
			<h2
				title={label}
				className="flex min-w-0 flex-wrap items-center gap-2 px-3.5 pt-3.5 pb-2.5 text-sm font-semibold"
			>
				<StageDot status={stage}>{null}</StageDot>
				{label}
				{applications.length > 0 && (
					<span className="font-mono text-xs font-medium text-ink-3">{i18n.number(applications.length)}</span>
				)}
				{onSaveJob && (
					<IconButton
						icon="plus"
						size="icon-xs"
						iconSize={16}
						label={t`Save a job to ${label}`}
						className="-my-1 ms-auto -me-0.5"
						onClick={onSaveJob}
					/>
				)}
			</h2>
			<div
				ref={setNodeRef}
				className={cn("flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2", active && "pb-10")}
			>
				{shown.map((application) => (
					<DraggableCard
						key={application.id}
						application={application}
						stale={stale.has(application.id)}
						onOpen={onOpen}
						onTagSelect={onTagSelect}
					/>
				))}
				{remaining > 0 && (
					<button
						type="button"
						onClick={() => setVisible((count) => count + COLUMN_PAGE_SIZE)}
						className="rounded-lg border border-dashed border-line-2 py-2 text-xs text-ink-3 transition-colors hover:bg-hover"
					>
						{t`Show ${i18n.number(Math.min(remaining, COLUMN_PAGE_SIZE))} more`}
					</button>
				)}
				{landing && (
					<div
						aria-hidden="true"
						className={cn(slotClassName, "bg-accent-soft outline-accent")}
						style={{ height: active.rect.current.initial?.height ?? 118 }}
					/>
				)}
			</div>
		</section>
	);
}

type DraggableCardProps = {
	application: ApplicationSummary;
	stale: boolean;
	onOpen: (application: ApplicationSummary) => void;
	onTagSelect?: ((tag: string) => void) | undefined;
};

// Re-renders with every drag context change; the closure here stays stable, so the card itself doesn't.
function DraggableCard({ application, stale, onOpen, onTagSelect }: DraggableCardProps) {
	const { setNodeRef, listeners, isDragging } = useDraggable({
		id: application.id,
		data: { label: [application.company, application.role].filter(Boolean).join(", ") } satisfies DndLabel,
	});

	return (
		// Where the card was stays marked while it's in the air.
		<div ref={setNodeRef} {...listeners} className={cn(isDragging && cn(slotClassName, "outline-ink-3 *:invisible"))}>
			<ApplicationCard
				application={application}
				onClick={() => onOpen(application)}
				onTagSelect={onTagSelect}
				withMenu
				stale={stale}
			/>
		</div>
	);
}

type BoardResizeHandleProps = {
	/** The column the line follows; it sits in the gap after it. */
	index: number;
	scroller: RefObject<HTMLDivElement | null>;
	width: number | undefined;
	resizing: boolean;
	onResize: (width: number) => void;
	onCommit: (width: number) => void;
	onCancel: () => void;
	/** Double-click: back to sharing the board evenly. */
	onReset: () => void;
};

/**
 * The line in the gap after a column. Dragging it sets one width for every column, worked out from where the line is
 * so it stays under the pointer: past the column there are `index + 1` widths and `index` gaps, plus half a gap. Arrow
 * keys move it 8px (Shift for 32px), and a double-click goes back to the automatic width.
 */
function BoardResizeHandle({
	index,
	scroller,
	width,
	resizing,
	onResize,
	onCommit,
	onCancel,
	onReset,
}: BoardResizeHandleProps) {
	// Where the drag started; it only counts once the pointer moves, so a click (or a double-click) changes nothing.
	const dragging = useRef<{ x: number; moved: boolean } | null>(null);

	const widthAt = (clientX: number) => {
		const board = scroller.current;
		if (!board) return null;
		const rect = board.getBoundingClientRect();
		const rtl = getComputedStyle(board).direction === "rtl";
		const offset = rtl ? rect.right - clientX - board.scrollLeft : clientX - rect.left + board.scrollLeft;
		return clampBoardColumnWidth((offset - index * COLUMN_GAP - COLUMN_GAP / 2) / (index + 1));
	};

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label={t`Resize the columns`}
			aria-valuemin={BOARD_COLUMN_WIDTH.min}
			aria-valuemax={BOARD_COLUMN_WIDTH.max}
			{...(width === undefined ? {} : { "aria-valuenow": width })}
			tabIndex={0}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				event.stopPropagation();
				event.currentTarget.setPointerCapture(event.pointerId);
				dragging.current = { x: event.clientX, moved: false };
			}}
			onPointerMove={(event) => {
				const start = dragging.current;
				if (!start) return;
				if (!start.moved && Math.abs(event.clientX - start.x) < 3) return;
				start.moved = true;
				const next = widthAt(event.clientX);
				if (next !== null) onResize(next);
			}}
			onPointerUp={(event) => {
				const start = dragging.current;
				if (!start) return;
				dragging.current = null;
				const next = start.moved ? widthAt(event.clientX) : null;
				if (next === null) onCancel();
				else onCommit(next);
			}}
			onPointerCancel={() => {
				dragging.current = null;
				onCancel();
			}}
			onDoubleClick={onReset}
			onKeyDown={(event) => {
				if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
				event.preventDefault();
				const column = event.currentTarget.parentElement;
				const current = width ?? column?.getBoundingClientRect().width ?? BOARD_COLUMN_WIDTH.min;
				const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
				// The line moves with the arrow; it's on the column's end side, so moving it that way widens the column.
				const outward = (event.key === "ArrowRight") !== rtl ? 1 : -1;
				onCommit(clampBoardColumnWidth(current + outward * (event.shiftKey ? 32 : 8)));
			}}
			className={cn(
				"absolute inset-y-0 -end-[9px] z-10 w-1.5 cursor-col-resize touch-none outline-none",
				"after:absolute after:inset-y-3 after:start-0.5 after:w-0.5 after:rounded-full after:transition-colors after:duration-quick",
				"hover:after:bg-line-2 focus-visible:after:inset-y-0 focus-visible:after:bg-accent",
				resizing && "after:inset-y-0 after:bg-accent hover:after:bg-accent",
			)}
		/>
	);
}
