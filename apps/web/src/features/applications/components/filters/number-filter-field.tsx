import type { NumberFilterKind } from "../../filter";
import type { KeyboardEvent } from "react";
import { useRef, useState } from "react";
import { Input } from "@reactive-resume/ui/components/input";
import { cn } from "@reactive-resume/utils/style";
import { numberFieldText, steppedNumberValue, typedNumberValue } from "../../filter";

/** Marks the field a filter's popover puts the cursor in when it opens. */
export const INITIAL_FOCUS_ATTRIBUTE = "data-initial-focus";

type NumberFilterFieldProps = {
	/** The filter value: "any", "none" or a number as text. */
	value: string;
	kind: NumberFilterKind;
	label: string;
	/** `replace` is true after the first change since the field got focus, so the address keeps one step per edit. */
	onChange: (value: string, replace: boolean) => void;
	/** Enter: the popover closes; with none given, Enter just leaves the field (the phone's keypad goes away). */
	onDone?: () => void;
	initialFocus?: boolean;
	className?: string;
};

/**
 * A narrow number field for Fit and Dates: digits only, filtering as you type. Up and Down step by 1, Shift with them
 * by 5; from empty they start at 80 for a fit and 7 for days.
 */
export function NumberFilterField({
	value,
	kind,
	label,
	onChange,
	onDone,
	initialFocus,
	className,
}: NumberFilterFieldProps) {
	const shown = numberFieldText(value);
	// What's typed shows at once, before the address catches up. While the field has focus, the address echoing back an
	// earlier keystroke ("7" on the way to "75") is ignored; any other change (Clear, None yet, Back) shows.
	const [text, setText] = useState(shown);
	const [prevShown, setPrevShown] = useState(shown);
	const [sent, setSent] = useState<readonly string[]>([]);
	if (shown !== prevShown) {
		setPrevShown(shown);
		if (!sent.includes(shown)) setText(shown);
	}
	const changed = useRef(false);

	const apply = (next: string) => {
		const nextText = numberFieldText(next);
		setText(nextText);
		if (next === value) return;
		setSent((current) => [...current, nextText]);
		onChange(next, changed.current);
		changed.current = true;
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowUp" || event.key === "ArrowDown") {
			event.preventDefault();
			const delta = (event.shiftKey ? 5 : 1) * (event.key === "ArrowUp" ? 1 : -1);
			apply(steppedNumberValue(value, kind, delta));
		} else if (event.key === "Enter") {
			event.preventDefault();
			if (onDone) onDone();
			else event.currentTarget.blur();
		}
	};

	return (
		<Input
			type="text"
			inputMode="numeric"
			pattern="[0-9]*"
			maxLength={3}
			autoComplete="off"
			aria-label={label}
			value={text}
			onFocus={() => {
				changed.current = false;
				setSent([]);
			}}
			onBlur={() => setSent([])}
			onChange={(event) => apply(typedNumberValue(event.target.value, kind))}
			onKeyDown={onKeyDown}
			{...(initialFocus ? { [INITIAL_FOCUS_ATTRIBUTE]: "" } : {})}
			className={cn(
				"h-[30px] w-[52px] px-1 text-center text-[13px] tabular-nums",
				text !== "" && "font-semibold",
				className,
			)}
		/>
	);
}
