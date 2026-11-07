import type { DragEndEvent } from "@dnd-kit/core";
import type { ListColumn, ListColumnId } from "@reactive-resume/schema/applications/layout";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { LIST_COLUMN_IDS } from "@reactive-resume/schema/applications/layout";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { cn } from "@reactive-resume/utils/style";
import { LIST_COLUMNS } from "./list-columns";
import { useMediaQuery } from "@/hooks/use-media-query";

type ColumnsButtonProps = {
	/** The shown columns after Role, in order, with any width that was set. */
	columns: readonly ListColumn[];
	onChange: (columns: ListColumn[]) => void;
	/** Back to the default columns, order and widths. */
	onReset: () => void;
};

/**
 * Columns, for the List: the shown columns in order with grips to drag them, More columns to tick, and Reset. Role is
 * always first. Below a 1400px window the button is its icon only.
 */
export function ColumnsButton({ columns, onChange, onReset }: ColumnsButtonProps) {
	// The label hides below a 1400px window (`max-[1400px]:sr-only`); the icon alone gets a tooltip.
	const iconOnly = useMediaQuery("(max-width: 1399.98px)");
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);
	const shownIds = columns.map((column) => column.id);
	const hidden = LIST_COLUMN_IDS.filter((id) => !shownIds.includes(id));

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) return;
		const from = shownIds.indexOf(active.id as ListColumnId);
		const to = shownIds.indexOf(over.id as ListColumnId);
		if (from < 0 || to < 0) return;
		onChange(arrayMove([...columns], from, to));
	};

	return (
		<Popover>
			<PopoverTrigger
				title={iconOnly ? t`Columns` : undefined}
				className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-line-2 bg-raised px-2 text-[13px] whitespace-nowrap text-ink transition-colors duration-quick outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent data-popup-open:border-accent data-popup-open:ring-1 data-popup-open:ring-accent min-[1400px]:ps-2 min-[1400px]:pe-2.5"
			>
				<Icon name="columns" size={16} className="text-ink-2" />
				<span className="max-[1400px]:sr-only">
					<Trans>Columns</Trans>
				</span>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				sideOffset={6}
				className="max-h-[min(640px,var(--available-height))] w-[264px] gap-0 overflow-y-auto p-1.5"
			>
				<div className="flex items-baseline justify-between px-2 pt-1 pb-1.5 text-xs font-medium text-ink-3">
					<Trans>Shown</Trans>
					<button type="button" onClick={onReset} className="font-normal text-accent-text hover:underline">
						<Trans>Reset</Trans>
					</button>
				</div>
				<div className="flex items-center gap-2.5 px-2 py-1.5">
					<Icon name="dots-six-vertical" size={14} className="text-ink-3 opacity-45" />
					<Checkbox checked disabled aria-label={t`Role`} />
					<span>
						<Trans>Role</Trans>
					</span>
					<span className="ms-auto text-[11.5px] text-ink-3">
						<Trans>Always first</Trans>
					</span>
				</div>
				<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
					<SortableContext items={shownIds} strategy={verticalListSortingStrategy}>
						{columns.map((column) => (
							<ShownColumnRow
								key={column.id}
								id={column.id}
								onHide={() => onChange(columns.filter((item) => item.id !== column.id))}
							/>
						))}
					</SortableContext>
				</DndContext>
				{hidden.length > 0 && (
					<>
						<div className="my-1.5 h-px bg-line" />
						<div className="px-2 pt-1 pb-1.5 text-xs font-medium text-ink-3">
							<Trans>More columns</Trans>
						</div>
						{hidden.map((id) => (
							// oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the checkbox inside the label is the control
							<label
								key={id}
								className="flex cursor-pointer items-center gap-2.5 rounded-md py-1.5 ps-[30px] pe-2 transition-colors hover:bg-hover"
							>
								<Checkbox checked={false} onCheckedChange={() => onChange([...columns, { id }])} />
								{LIST_COLUMNS[id].label()}
							</label>
						))}
					</>
				)}
				<div className="my-1.5 h-px bg-line" />
				<p className="px-2 pb-1 text-[11.5px] text-ink-3">
					<Trans>Drag to reorder. To resize, drag the line between two headings.</Trans>
				</p>
			</PopoverContent>
		</Popover>
	);
}

type ShownColumnRowProps = { id: ListColumnId; onHide: () => void };

function ShownColumnRow({ id, onHide }: ShownColumnRowProps) {
	const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
		id,
	});
	const label = LIST_COLUMNS[id].label();

	return (
		<div
			ref={setNodeRef}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className={cn(
				"flex items-center gap-2.5 rounded-md px-2 transition-colors hover:bg-hover",
				isDragging && "relative z-10 bg-sunken shadow-e1",
			)}
		>
			<button
				type="button"
				ref={setActivatorNodeRef}
				{...attributes}
				{...listeners}
				aria-label={t`Move ${label}`}
				className="-mx-0.5 grid cursor-grab touch-none place-items-center rounded py-1.5 text-ink-3 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
			>
				<Icon name="dots-six-vertical" size={14} />
			</button>
			{/* oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the checkbox inside the label is the control */}
			<label className="flex flex-1 cursor-pointer items-center gap-2.5 py-1.5">
				<Checkbox checked onCheckedChange={onHide} />
				{label}
			</label>
		</div>
	);
}
