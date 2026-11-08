import type { FilterContext } from "../../filter";
import type { ApplicationFilters, ApplicationSort } from "@reactive-resume/schema/applications/filters";
import type { ListColumnId } from "@reactive-resume/schema/applications/layout";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useId, useState } from "react";
import { APPLICATION_VIEW_NAME_MAX } from "@reactive-resume/schema/applications/views";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@reactive-resume/ui/components/dialog";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { FACETS, getFacetLabel, isFacetSet, summary } from "../../filter";
import { getDirectionOptions, getSortLabel } from "../../sort";
import { isNameTaken } from "../../use-saved-views";
import { LIST_COLUMNS } from "../list-columns";

/** "Fit, highest first". */
export function sortText(sort: ApplicationSort) {
	const field = getSortLabel(sort.sort);
	const direction = getDirectionOptions(sort.sort).find((option) => option.dir === sort.dir)?.label ?? "";
	const lower = direction.charAt(0).toLocaleLowerCase() + direction.slice(1);
	return t`${field}, ${lower}`;
}

/** The set filters as "Label: value" chips, in the toolbar's order. */
export const filterChips = (filters: ApplicationFilters, context: Pick<FilterContext, "noReplyDays">) =>
	FACETS.filter((facet) => isFacetSet(filters, facet)).map(
		(facet) => `${getFacetLabel(facet)}: ${summary(filters, facet, { noReplyDays: context.noReplyDays }) ?? ""}`,
	);

type SaveViewDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** What the view will keep. */
	filters: ApplicationFilters;
	sort: ApplicationSort;
	columns: readonly ListColumnId[];
	noReplyDays: number;
	/** Saves it; a taken name rejects with a conflict, which the dialog shows under the name. */
	onSave: (name: string, isDefault: boolean) => Promise<void>;
	/** The name of the view that has this name, ignoring case, as the user wrote it. */
	existingName: (name: string) => string;
};

/**
 * Save as a view: a name (up to 60 characters, unique ignoring case), a summary of what it keeps, and whether a new
 * tab opens with it.
 */
export function SaveViewDialog({ open, onOpenChange, ...props }: SaveViewDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false} className="gap-3 p-5 sm:max-w-[460px]">
				{/* A fresh form each time it opens. */}
				{open && <SaveViewForm {...props} onClose={() => onOpenChange(false)} />}
			</DialogContent>
		</Dialog>
	);
}

type SaveViewFormProps = Omit<SaveViewDialogProps, "open" | "onOpenChange"> & { onClose: () => void };

function SaveViewForm({ filters, sort, columns, noReplyDays, onSave, existingName, onClose }: SaveViewFormProps) {
	const id = useId();
	const [name, setName] = useState("");
	const [isDefault, setIsDefault] = useState(false);
	const [taken, setTaken] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const chips = filterChips(filters, { noReplyDays });
	const columnNames = [t`Role`, ...columns.map((column) => LIST_COLUMNS[column].label())].join(", ");

	const submit = async () => {
		const trimmed = name.trim();
		if (!trimmed || saving) return;
		setSaving(true);
		try {
			await onSave(trimmed, isDefault);
			onClose();
		} catch (error) {
			if (isNameTaken(error)) setTaken(existingName(trimmed));
			else toast.add({ type: "error", description: t`Couldn't save the view. Try again.` });
		} finally {
			setSaving(false);
		}
	};

	return (
		<form
			className="grid gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<div className="grid gap-1">
				<DialogTitle className="text-[22px] leading-7">
					<Trans>Save as a view</Trans>
				</DialogTitle>
				<DialogDescription className="text-[13px] text-ink-2">
					<Trans>Saves the filters, sort and List columns you have now.</Trans>
				</DialogDescription>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor={`${id}-name`}>
					<Trans>Name</Trans>
				</Label>
				<Input
					id={`${id}-name`}
					autoFocus
					autoComplete="off"
					maxLength={APPLICATION_VIEW_NAME_MAX}
					placeholder={t`Ready to apply`}
					value={name}
					aria-invalid={taken !== null}
					aria-describedby={taken !== null ? `${id}-error` : undefined}
					onChange={(event) => {
						setName(event.target.value);
						setTaken(null);
					}}
				/>
				{taken !== null && (
					<p id={`${id}-error`} className="text-[12.5px] text-danger-text">
						<Trans>You already have a view called “{taken}”. Pick another name, or use Update in the Views menu.</Trans>
					</p>
				)}
			</div>
			<dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 rounded-lg bg-sunken px-3 py-2.5 text-[12.5px]">
				<dt className="text-ink-3">
					<Trans>Filters</Trans>
				</dt>
				<dd className="flex flex-wrap gap-1 text-ink-2">
					{chips.length > 0 ? (
						chips.map((chip) => (
							<span
								key={chip}
								className="inline-flex h-5 items-center rounded-[5px] bg-accent-soft px-[7px] text-xs whitespace-nowrap text-accent-text"
							>
								{chip}
							</span>
						))
					) : (
						<Trans>None, all open applications</Trans>
					)}
				</dd>
				<dt className="text-ink-3">
					<Trans>Sort</Trans>
				</dt>
				<dd className="text-ink-2">{sortText(sort)}</dd>
				<dt className="text-ink-3">
					<Trans>Columns</Trans>
				</dt>
				<dd className="text-ink-2">{columnNames}</dd>
			</dl>
			{/* oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the checkbox inside the label is the control */}
			<label className="flex cursor-pointer items-center gap-2.5 text-sm select-none">
				<Checkbox checked={isDefault} onCheckedChange={(checked) => setIsDefault(checked === true)} />
				<span>
					<Trans>Open Applications with this view</Trans>{" "}
					<span className="text-xs text-ink-3">
						<Trans>in a new tab</Trans>
					</span>
				</span>
			</label>
			<div className="mt-1 flex justify-end gap-2">
				<Button type="button" variant="secondary" onClick={onClose}>
					<Trans>Cancel</Trans>
				</Button>
				<Button type="submit" disabled={!name.trim() || saving} className={cn(saving && "cursor-progress")}>
					<Trans>Save view</Trans>
				</Button>
			</div>
		</form>
	);
}
