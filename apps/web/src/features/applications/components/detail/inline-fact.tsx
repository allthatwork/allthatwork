import { useId, useState } from "react";
import { Input } from "@reactive-resume/ui/components/input";
import { cn } from "@reactive-resume/utils/style";
import { factLabelClassName, factRowClassName } from "./sheet-parts";
import { isImeComposing } from "@/libs/keyboard";

type InlineFactProps = {
	label: string;
	value: string | null;
	onSave: (value: string | null) => void;
	/** Offered while typing; the field still takes anything. */
	suggestions?: readonly string[];
	/** How the saved value reads when it isn't being edited. */
	display?: (value: string) => string;
	placeholder?: string;
};

/** A fact row (`.kv`) that edits in place: click to type, Enter or leaving saves, Esc cancels. Sits inside a `<dl>`. */
export function InlineFact({ label, value, onSave, suggestions, display, placeholder }: InlineFactProps) {
	const id = useId();
	const listId = `${id}-suggestions`;
	const [draft, setDraft] = useState<string | null>(null);

	const commit = () => {
		if (draft === null) return;
		const next = draft.trim() || null;
		if (next !== (value ?? null)) onSave(next);
		setDraft(null);
	};

	return (
		<div className={factRowClassName}>
			<dt className={factLabelClassName}>
				<label htmlFor={id} className="block leading-5">
					{label}
				</label>
			</dt>
			<dd className="min-w-0">
				{draft === null ? (
					<button
						id={id}
						type="button"
						onClick={() => setDraft(value ?? "")}
						className={cn(
							"block w-full cursor-text truncate rounded-xs text-start hover:underline",
							!value && "text-ink-3",
						)}
					>
						{value ? (display ? display(value) : value) : "—"}
					</button>
				) : (
					<>
						<Input
							id={id}
							autoFocus
							value={draft}
							className="h-8"
							placeholder={placeholder}
							list={suggestions?.length ? listId : undefined}
							onChange={(event) => setDraft(event.target.value)}
							onBlur={commit}
							onKeyDown={(event) => {
								if (isImeComposing(event)) return;
								if (event.key === "Enter") commit();
								if (event.key === "Escape") {
									event.stopPropagation();
									setDraft(null);
								}
							}}
						/>
						{suggestions?.length ? (
							<datalist id={listId}>
								{suggestions.map((suggestion) => (
									<option key={suggestion} value={suggestion} />
								))}
							</datalist>
						) : null}
					</>
				)}
			</dd>
		</div>
	);
}
