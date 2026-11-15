import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useRef } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { cn } from "@reactive-resume/utils/style";
import { INITIAL_FOCUS_ATTRIBUTE } from "./number-filter-field";

type FilterButtonProps = {
	label: string;
	/** What follows the label ("Built", "Dorel, Muse"); null when the filter isn't set. */
	value: string | null;
	/** Set filters turn blue, show their value in bold and get an × that clears them. */
	active: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onClear: () => void;
	/** The popover's width, when not the default. */
	popoverClassName?: string | undefined;
	children: ReactNode;
};

/**
 * A filter's button and its popover. Unset: the label and a caret, plain. Set: "Label: value" on the accent tint,
 * with an × beside the trigger that clears just this filter. Stage's default reads "Stage: Open" in the plain style.
 */
export function FilterButton({
	label,
	value,
	active,
	open,
	onOpenChange,
	onClear,
	popoverClassName,
	children,
}: FilterButtonProps) {
	const focusTarget = useRef<HTMLDivElement>(null);
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			{/* Calm's chip (`.chip`): 28px, a quiet outline; a set filter takes the accent tint, like a pressed chip. */}
			<span
				data-slot="chip"
				className={cn(
					"inline-flex h-7 shrink-0 items-center rounded-sm text-[13px]/[18px] font-medium whitespace-nowrap transition-colors duration-quick",
					active
						? "bg-accent-soft text-accent-text"
						: "text-ink-2 shadow-[inset_0_0_0_1px_var(--line-2)] hover:bg-hover hover:text-ink",
					open && !active && "bg-hover text-ink",
				)}
			>
				<PopoverTrigger
					className={cn(
						"touch-target relative inline-flex h-full items-center gap-1 rounded-sm ps-2.5 outline-none focus-visible:ring-2 focus-visible:ring-accent",
						active ? "pe-1" : "pe-2",
					)}
				>
					<span>
						{value === null ? label : `${label}: `}
						{value !== null && <span className={cn(active && "font-semibold")}>{value}</span>}
					</span>
					{!active && <Icon name="caret-down" size={14} className="text-ink-3" />}
				</PopoverTrigger>
				{active && (
					<button
						type="button"
						aria-label={t`Clear ${label}`}
						onClick={onClear}
						className="touch-target relative me-1.5 grid size-[18px] place-items-center rounded-xs text-accent-text transition-colors hover:bg-hover"
					>
						<Icon name="x" size={14} />
					</button>
				)}
			</span>
			<PopoverContent
				align="start"
				sideOffset={6}
				// Fit and Dates open with the cursor in their first field; the others focus as before.
				initialFocus={() => focusTarget.current?.querySelector<HTMLElement>(`[${INITIAL_FOCUS_ATTRIBUTE}]`) ?? true}
				ref={focusTarget}
				className={cn("w-[284px] gap-0 p-1", popoverClassName)}
			>
				{children}
			</PopoverContent>
		</Popover>
	);
}
