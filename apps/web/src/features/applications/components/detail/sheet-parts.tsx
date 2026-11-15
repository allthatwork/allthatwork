import type { ComponentProps, ReactNode } from "react";
import { cn } from "@reactive-resume/utils/style";

type SheetSectionProps = {
	id?: string;
	note?: ReactNode;
	action?: ReactNode;
	children: ReactNode;
	render?: (className: string, content: ReactNode) => ReactNode;
};

/** A heading inside the details sheet (`.sx`): 14px semibold, a quiet note after it, its one action at the end. */
export function SheetSection({ id, note, action, children, render }: SheetSectionProps) {
	const className = "flex shrink-0 flex-wrap items-baseline gap-2 pt-5 pb-1.5 text-sm/5 font-semibold text-ink";
	const content = (
		<>
			{children}
			{note && <small className="text-[13px]/[18px] font-normal text-ink-3">{note}</small>}
			{action && <span className="ms-auto font-normal">{action}</span>}
		</>
	);
	if (render) return render(className, content);
	return (
		<h3 id={id} className={className}>
			{content}
		</h3>
	);
}

/** The accent text button of a sheet heading or row (`.lk`, `.ttb`). */
export function TextButton({ className, ...props }: ComponentProps<"button">) {
	return (
		<button
			type="button"
			className={cn(
				"rounded-xs text-[13px]/[18px] font-medium text-accent-text hover:underline disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}

/** A row of the sheet's facts (`.kv`): a 104px label, the value, a hairline below. */
export const factRowClassName =
	"grid min-h-[33px] grid-cols-[104px_minmax(0,1fr)] items-center gap-3 border-b border-line text-sm/5 last:border-0";
export const factLabelClassName = "text-[13px] font-normal text-ink-3";
