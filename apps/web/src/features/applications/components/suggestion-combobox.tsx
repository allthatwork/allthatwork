import type { ComboboxTriggerState } from "@base-ui/react/combobox";
import type { UseRenderRenderProp } from "@base-ui/react/use-render";
import { t } from "@lingui/core/macro";
import { useMemo, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	ComboboxClear,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	ComboboxRoot,
	ComboboxTrigger,
	ComboboxValue,
	useFilter,
} from "@reactive-resume/ui/components/combobox";
import { Input } from "@reactive-resume/ui/components/input";
import { cn } from "@reactive-resume/utils/style";

type Option = { value: string; label: string; create?: boolean };

type SuggestionComboboxProps = {
	value: string | null;
	/** Offered in this order: values already in use first, then presets. */
	suggestions: readonly string[];
	onChange: (value: string | null) => void;
	placeholder?: string;
	id?: string;
	className?: string;
	render?: UseRenderRenderProp<ComboboxTriggerState>;
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * A free-text field with suggestions that are never hidden: it opens with every suggestion (the current value
 * included), filters as you type, and offers "Add …" for anything new. Clearing sets it to nothing.
 */
export function SuggestionCombobox({
	value,
	suggestions,
	onChange,
	placeholder,
	id,
	className,
	render,
}: SuggestionComboboxProps) {
	const { contains } = useFilter();
	const [query, setQuery] = useState("");

	const items = useMemo<Option[]>(() => {
		const values = [...suggestions];
		if (value && !values.some((item) => same(item, value))) values.unshift(value);
		const options: Option[] = values.map((item) => ({ value: item, label: item }));
		const typed = query.trim();
		if (typed && !values.some((item) => same(item, typed)))
			options.push({ value: typed, label: t`Add “${typed}”`, create: true });
		return options;
	}, [suggestions, value, query]);

	const selected = value ? (items.find((item) => !item.create && same(item.value, value)) ?? null) : null;

	return (
		<ComboboxRoot
			items={items}
			filter={(item: Option, text: string) => item.create === true || contains(item.value, text)}
			value={selected}
			onValueChange={(item: Option | null) => {
				onChange(item?.value.trim() || null);
				setQuery("");
			}}
			inputValue={query}
			onInputValueChange={setQuery}
			itemToStringLabel={(item: Option) => item.value}
			isItemEqualToValue={(a: Option, b: Option) => same(a.value, b.value)}
		>
			<div className="relative w-full min-w-0">
				<ComboboxTrigger
					id={id}
					render={
						render ?? (
							<Button
								variant="secondary"
								className={cn("w-full justify-start text-left font-normal hover:bg-sunken/20", className)}
							/>
						)
					}
				>
					<span className={cn("min-w-0 flex-1 truncate text-left", value && "pe-7")}>
						<ComboboxValue placeholder={placeholder ?? t`Choose or type…`} />
					</span>
				</ComboboxTrigger>
				{value && (
					<ComboboxClear
						aria-label={t`Clear`}
						className="absolute end-7 top-1/2 z-10 -translate-y-1/2 text-ink-3 opacity-70 hover:opacity-100 focus-visible:opacity-100"
					/>
				)}
			</div>
			<ComboboxContent aria-label={placeholder ?? t`Options`}>
				<ComboboxInput
					placeholder={t`Search or add…`}
					render={<Input className="border-none focus-visible:border-none focus-visible:ring-0" />}
				/>
				<ComboboxEmpty>{t`Type a name to add it.`}</ComboboxEmpty>
				<ComboboxList>
					{(item: Option) => (
						<ComboboxItem key={`${item.create ? "+" : ""}${item.value}`} value={item}>
							<span className={cn(item.create && "text-accent-text")}>{item.label}</span>
						</ComboboxItem>
					)}
				</ComboboxList>
			</ComboboxContent>
		</ComboboxRoot>
	);
}
