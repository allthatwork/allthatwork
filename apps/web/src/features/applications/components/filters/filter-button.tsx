import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { cn } from "@reactive-resume/utils/style";

type FilterButtonProps = {
	label: string;
	/** What follows the label ("Built", "Dorel, Muse"); null when the filter isn't set. */
	value: string | null;
	/** Set filters turn blue, show their value in bold and get an × that clears them. */
	active: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onClear: () => void;
	/** The wider popover, for Lane, Fit and Tags. */
	wide?: boolean;
	children: ReactNode;
};

/**
 * A filter's button and its popover. Unset: the label and a caret, plain. Set: "Label: value" on the accent tint,
 * with an × beside the trigger that clears just this filter. Stage's default reads "Stage: Open" in the plain style.
 */
export function FilterButton({ label, value, active, open, onOpenChange, onClear, wide, children }: FilterButtonProps) {
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<span
				className={cn(
					"inline-flex h-8 shrink-0 items-center rounded-lg border text-[13px] whitespace-nowrap transition-colors duration-quick",
					active
						? "border-transparent bg-accent-soft text-accent-text"
						: "border-line-2 bg-raised text-ink hover:bg-hover",
					open && "border-accent ring-1 ring-accent",
				)}
			>
				<PopoverTrigger
					className={cn(
						"inline-flex h-full items-center gap-1 rounded-lg ps-[11px] outline-none focus-visible:ring-2 focus-visible:ring-accent",
						active ? "pe-1" : "pe-2",
					)}
				>
					<span>
						{value === null ? label : `${label}: `}
						{value !== null && <span className={cn(active && "font-semibold")}>{value}</span>}
					</span>
					{!active && <Icon name="caret-down" size={13} className="text-ink-3" />}
				</PopoverTrigger>
				{active && (
					<button
						type="button"
						aria-label={t`Clear ${label}`}
						onClick={onClear}
						className="me-1.5 grid size-[18px] place-items-center rounded transition-colors hover:bg-hover"
					>
						<Icon name="x" size={12} />
					</button>
				)}
			</span>
			<PopoverContent align="start" sideOffset={6} className={cn("w-[284px] gap-0 p-1.5", wide && "w-[340px]")}>
				{children}
			</PopoverContent>
		</Popover>
	);
}
