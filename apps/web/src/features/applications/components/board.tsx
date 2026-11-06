import type { Application } from "../types";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import {
	DndContext,
	DragOverlay,
	defaultDropAnimationSideEffects,
	PointerSensor,
	pointerWithin,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { APPLICATION_STATUSES } from "@reactive-resume/schema/applications/data";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { cn } from "@reactive-resume/utils/style";
import { CLOSED_REASONS, getClosedReasonLabel, getStageColor, getStageLabel } from "../stages";
import { useApplicationActions } from "../use-application-actions";
import { ApplicationCard } from "./application-card";
import { getEdgeFadeStyle, useScrollEdges } from "@/hooks/use-scroll-edges";
import { DRAG_SETTLE } from "@/libs/motion";

type BoardProps = {
	applications: Application[];
	/** The stages the filters show; a column each, in pipeline order with Closed last. */
	stages: readonly ApplicationStatus[];
	/** Cards changed since the last filter change that no longer match, with the column they showed in. */
	stale?: ReadonlyMap<string, ApplicationStatus>;
	onOpen: (application: Application) => void;
};

const NO_STALE: ReadonlyMap<string, ApplicationStatus> = new Map();

// While the overlay settles, the real card waits hidden in its new slot and the overlay's tilt eases off.
const dropSideEffects = defaultDropAnimationSideEffects({
	styles: { active: { opacity: "0" } },
	className: { dragOverlay: "is-dropping" },
});

/**
 * A column per stage the filters show. Dropping a card on a column moves it, with the same toast as the other ways to
 * change stage; each card's menu has Move to… for the keyboard. There's no column for a filtered-out stage to drop on.
 * Desktop and tablet only. The columns share the width evenly, at least 256px each and never wider than with five
 * showing, so a one-stage board keeps card-sized columns on the left; past that the board scrolls sideways, with a fade
 * on the side that has more.
 */
export function ApplicationBoard({ applications, stages: chosen, stale = NO_STALE, onOpen }: BoardProps) {
	const { moveTo, close } = useApplicationActions();
	const reduceMotion = useReducedMotion();
	const [activeId, setActiveId] = useState<string | null>(null);
	const [closing, setClosing] = useState<Application | null>(null);
	// The list query publishes the optimistic move a task after the drop (TanStack Query notifies on a timeout), so
	// until it does the board shows the dropped card in its new column itself. Otherwise the card blinks back to its
	// old column for a frame, and the drop animation would fly there.
	const [pendingMove, setPendingMove] = useState<{ id: string; from: ApplicationStatus; to: ApplicationStatus } | null>(
		null,
	);

	// The query caught up, rolled back, or the card went away: the override has done its job.
	if (
		pendingMove &&
		applications.find((application) => application.id === pendingMove.id)?.status !== pendingMove.from
	) {
		setPendingMove(null);
	}
	const stages = APPLICATION_STATUSES.filter((stage) => chosen.includes(stage));
	// A changed card whose stage is filtered out stays in the column it was in until the filters change.
	const statusOf = (application: Application) => {
		if (pendingMove?.id === application.id) return pendingMove.to;
		if (stages.includes(application.status)) return application.status;
		return stale.get(application.id) ?? application.status;
	};

	// A small activation distance so a click still opens the detail sheet instead of starting a drag.
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

	const byStage = new Map<ApplicationStatus, Application[]>(stages.map((stage) => [stage, []]));
	for (const application of applications) byStage.get(statusOf(application))?.push(application);

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
		moveTo(application, target);
	};

	return (
		<DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd}>
			<div ref={scrollerRef} style={getEdgeFadeStyle(edges)} className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-3">
				{stages.map((stage) => (
					<Column key={stage} stage={stage} applications={byStage.get(stage) ?? []} stale={stale} onOpen={onOpen} />
				))}
			</div>

			{/* The overlay settles into the card's new slot (or back where it came from); the drop itself shows at once, see pendingMove. */}
			<DragOverlay dropAnimation={reduceMotion ? null : { ...DRAG_SETTLE, sideEffects: dropSideEffects }}>
				{active ? <ApplicationCard application={active} dragging /> : null}
			</DragOverlay>
			<Dialog open={Boolean(closing)} onOpenChange={(open) => !open && setClosing(null)}>
				<DialogContent className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle>
							<Trans>Close application</Trans>
						</DialogTitle>
						<DialogDescription>
							{closing?.role} · {closing?.company}
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
	applications: Application[];
	stale: ReadonlyMap<string, ApplicationStatus>;
	onOpen: (application: Application) => void;
};

function Column({ stage, applications, stale, onOpen }: ColumnProps) {
	const { setNodeRef, isOver } = useDroppable({ id: stage });
	const [visible, setVisible] = useState(COLUMN_PAGE_SIZE);
	const shown = applications.slice(0, visible);
	const remaining = applications.length - shown.length;

	return (
		<section
			aria-label={getStageLabel(stage)}
			className={cn(
				"flex max-w-[calc((100%-48px)/5)] min-w-64 flex-1 basis-0 flex-col rounded-xl border bg-sunken transition-colors duration-quick",
				isOver ? "border-accent bg-accent-soft" : "border-transparent",
			)}
		>
			<h2 className="flex items-center gap-2 px-3 py-2.5 text-sm font-semibold">
				<span aria-hidden="true" className="size-2 rounded-full" style={{ background: getStageColor(stage) }} />
				{getStageLabel(stage)}
				<span className="font-mono text-xs font-normal text-ink-3">{applications.length}</span>
			</h2>
			<div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
				{shown.map((application) => (
					<DraggableCard
						key={application.id}
						application={application}
						stale={stale.has(application.id)}
						onOpen={() => onOpen(application)}
					/>
				))}
				{remaining > 0 && (
					<button
						type="button"
						onClick={() => setVisible((count) => count + COLUMN_PAGE_SIZE)}
						className="rounded-lg border border-dashed border-line py-2 text-xs text-ink-3 transition-colors hover:bg-hover"
					>
						{t`Show ${Math.min(remaining, COLUMN_PAGE_SIZE)} more`}
					</button>
				)}
			</div>
		</section>
	);
}

type DraggableCardProps = { application: Application; stale: boolean; onOpen: () => void };

function DraggableCard({ application, stale, onOpen }: DraggableCardProps) {
	const { setNodeRef, listeners, isDragging } = useDraggable({ id: application.id });

	return (
		<div ref={setNodeRef} {...listeners} className={cn(isDragging && "opacity-40")}>
			<ApplicationCard application={application} onClick={onOpen} withMenu stale={stale} />
		</div>
	);
}
