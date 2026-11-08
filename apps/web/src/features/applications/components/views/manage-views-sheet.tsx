import type { DragEndEvent } from "@dnd-kit/core";
import type { ApplicationView } from "@reactive-resume/schema/applications/views";
import type { ReactNode } from "react";
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
import { useRef, useState } from "react";
import { APPLICATION_VIEW_NAME_MAX, APPLICATION_VIEWS_MAX } from "@reactive-resume/schema/applications/views";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@reactive-resume/ui/components/sheet";
import { cn } from "@reactive-resume/utils/style";

type ManageViewsSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	phone: boolean;
	views: readonly ApplicationView[];
	countOf: (view: ApplicationView) => number;
	onReorder: (ids: string[]) => void;
	/** Resolves false when the name can't be used, so the field stays open. */
	onRename: (view: ApplicationView, name: string) => Promise<boolean>;
	onToggleDefault: (view: ApplicationView) => void;
	onDelete: (view: ApplicationView) => void;
};

/**
 * Manage views: a sheet from the right (from the bottom on phones). Drag the grips to reorder, rename in place, star
 * the default, delete with Undo in the toast. Every change saves as it's made.
 */
export function ManageViewsSheet({
	open,
	onOpenChange,
	phone,
	views,
	countOf,
	onReorder,
	...row
}: ManageViewsSheetProps) {
	const [renaming, setRenaming] = useState<string | null>(null);
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);
	const ids = views.map((view) => view.id);

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) return;
		const from = ids.indexOf(String(active.id));
		const to = ids.indexOf(String(over.id));
		if (from < 0 || to < 0) return;
		onReorder(arrayMove(ids, from, to));
	};
	const count = views.length;

	return (
		<Sheet
			open={open}
			onOpenChange={(next) => {
				if (!next) setRenaming(null);
				onOpenChange(next);
			}}
		>
			<SheetContent side={phone ? "bottom" : "right"} className="gap-0 sm:max-w-[440px]">
				<div className={cn("grid gap-1 pe-14 pb-3.5", phone ? "ps-4 pt-1.5" : "ps-6 pt-5")}>
					<SheetTitle className="text-[22px] leading-7">
						<Trans>Views</Trans>
					</SheetTitle>
					<SheetDescription className="text-[13px] text-ink-2">
						<Trans>Drag to reorder. The star marks the view a new tab opens with.</Trans>
					</SheetDescription>
				</div>
				<div className="grid min-h-0 flex-1 content-start gap-0.5 overflow-y-auto px-3">
					{count === 0 ? (
						<p className="mx-2 text-xs text-ink-3">
							<Trans>No views yet.</Trans>
						</p>
					) : (
						<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
							<SortableContext items={ids} strategy={verticalListSortingStrategy}>
								{views.map((view) => (
									<ManageRow
										key={view.id}
										view={view}
										count={countOf(view)}
										renaming={renaming === view.id}
										onStartRename={() => setRenaming(view.id)}
										onStopRename={() => setRenaming(null)}
										{...row}
									/>
								))}
							</SortableContext>
						</DndContext>
					)}
				</div>
				<p
					className={cn(
						"mt-auto border-t border-line pt-3.5 text-xs text-ink-3",
						phone ? "px-4 pb-[calc(22px+env(safe-area-inset-bottom))]" : "px-6 pb-5",
					)}
				>
					<Trans>
						{count} of {APPLICATION_VIEWS_MAX} views. Names up to {APPLICATION_VIEW_NAME_MAX} characters.
					</Trans>
				</p>
			</SheetContent>
		</Sheet>
	);
}

type ManageRowProps = Pick<ManageViewsSheetProps, "onRename" | "onToggleDefault" | "onDelete"> & {
	view: ApplicationView;
	count: number;
	renaming: boolean;
	onStartRename: () => void;
	onStopRename: () => void;
};

function ManageRow({
	view,
	count,
	renaming,
	onStartRename,
	onStopRename,
	onRename,
	onToggleDefault,
	onDelete,
}: ManageRowProps) {
	const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
		id: view.id,
		disabled: renaming,
	});
	const name = view.name;

	return (
		<div
			ref={setNodeRef}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className={cn(
				"flex h-11 items-center gap-2 rounded-lg ps-1 pe-1.5 transition-colors hover:bg-hover",
				isDragging && "relative z-10 bg-sunken shadow-e1",
			)}
		>
			<button
				type="button"
				ref={setActivatorNodeRef}
				{...attributes}
				{...listeners}
				aria-label={t`Move ${name}`}
				className="grid shrink-0 cursor-grab touch-none place-items-center rounded py-0.5 text-ink-3 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
			>
				<Icon name="dots-six-vertical" size={14} />
			</button>
			{renaming ? (
				<RenameField view={view} onRename={onRename} onDone={onStopRename} />
			) : (
				<>
					<span className="min-w-0 truncate text-sm font-medium">{name}</span>
					<span className="ms-auto shrink-0 pe-1.5 font-mono text-xs text-ink-3 tabular-nums">{count}</span>
				</>
			)}
			<RowButton label={t`Rename`} onClick={onStartRename}>
				<Icon name="pencil-simple" size={15} />
			</RowButton>
			<RowButton
				label={
					view.isDefault ? t`A new tab opens with this view. Click to clear.` : t`Open Applications with this view`
				}
				pressed={view.isDefault}
				onClick={() => onToggleDefault(view)}
				className={cn(view.isDefault && "text-warn-text hover:text-warn-text")}
			>
				<Icon name="star" filled={view.isDefault} size={16} />
			</RowButton>
			<RowButton label={t`Delete`} onClick={() => onDelete(view)}>
				<Icon name="trash" size={15} />
			</RowButton>
		</div>
	);
}

type RowButtonProps = {
	label: string;
	pressed?: boolean;
	onClick: () => void;
	className?: string;
	children: ReactNode;
};

function RowButton({ label, pressed, onClick, className, children }: RowButtonProps) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			aria-pressed={pressed}
			onClick={onClick}
			className={cn(
				"grid size-[30px] shrink-0 place-items-center rounded-md text-ink-3 transition-colors outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent",
				className,
			)}
		>
			{children}
		</button>
	);
}

type RenameFieldProps = {
	view: ApplicationView;
	onRename: ManageViewsSheetProps["onRename"];
	onDone: () => void;
};

/** Enter or leaving the field saves, Esc cancels; an empty or unchanged name just closes it. */
function RenameField({ view, onRename, onDone }: RenameFieldProps) {
	const [value, setValue] = useState(view.name);
	// Enter or Esc closes the field; the blur that can follow mustn't save again.
	const settled = useRef(false);

	const save = async () => {
		if (settled.current) return;
		const name = value.trim();
		settled.current = true;
		if (!name || name === view.name) return onDone();
		const ok = await onRename(view, name);
		if (ok) onDone();
		else settled.current = false;
	};

	return (
		<Input
			autoFocus
			aria-label={t`Name`}
			maxLength={APPLICATION_VIEW_NAME_MAX}
			value={value}
			className="h-8 min-w-0 flex-1"
			onFocus={(event) => event.currentTarget.select()}
			onChange={(event) => setValue(event.target.value)}
			onBlur={() => void save()}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					void save();
				}
				if (event.key === "Escape") {
					// Cancels the rename only; the sheet stays open.
					event.preventDefault();
					event.stopPropagation();
					settled.current = true;
					onDone();
				}
			}}
		/>
	);
}
