import type { ApplicationSort, ApplicationSortKey } from "@reactive-resume/schema/applications/filters";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { APPLICATION_SORT_KEYS, defaultSortDirection } from "@reactive-resume/schema/applications/filters";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { RadioGroup, RadioGroupItem } from "@reactive-resume/ui/components/radio-group";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Sheet, SheetContent, SheetTitle } from "@reactive-resume/ui/components/sheet";
import { cn } from "@reactive-resume/utils/style";
import { getDirectionOptions, getSortLabel } from "../sort";

type SortButtonProps = {
	sort: ApplicationSort;
	onChange: (sort: ApplicationSort) => void;
};

/**
 * The direction as a glyph: largest or newest first shows the long bar on top and the arrow down. Phosphor names that
 * glyph "sort-ascending" (and the other one "sort-descending"), so the names look swapped here.
 */
const directionIcon = (dir: ApplicationSort["dir"]) => (dir === "desc" ? "sort-ascending" : "sort-descending");

/** Picking another field starts it in its own direction; picking the same one keeps the direction. */
const pick = (sort: ApplicationSort, key: ApplicationSortKey): ApplicationSort => ({
	sort: key,
	dir: key === sort.sort ? sort.dir : defaultSortDirection(key),
});

type SortChoicesProps = SortButtonProps & { large?: boolean };

/** The fields as radio rows, then the two directions worded for the field. */
function SortChoices({ sort, onChange, large = false }: SortChoicesProps) {
	return (
		<>
			<RadioGroup
				aria-label={t`Sort by`}
				value={sort.sort}
				onValueChange={(value) => onChange(pick(sort, value as ApplicationSortKey))}
				className="gap-0"
			>
				{APPLICATION_SORT_KEYS.map((key) => (
					// oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the radio inside the label is the control
					<label
						key={key}
						className={cn(
							"flex cursor-pointer items-center gap-2.5 rounded-md px-2 transition-colors hover:bg-hover",
							large ? "py-2.5 text-[15px]" : "py-1.5",
						)}
					>
						<RadioGroupItem value={key} />
						{getSortLabel(key)}
					</label>
				))}
			</RadioGroup>
			<div className="my-1.5 h-px bg-line" />
			<SegmentedControl
				aria-label={t`Direction`}
				value={sort.dir}
				onValueChange={(value) => onChange({ ...sort, dir: value as ApplicationSort["dir"] })}
				className="flex w-full"
			>
				{getDirectionOptions(sort.sort).map((option) => (
					<SegmentedControlItem key={option.dir} value={option.dir}>
						{option.label}
					</SegmentedControlItem>
				))}
			</SegmentedControl>
		</>
	);
}

/**
 * "Sort: Updated", with an icon that shows the direction. It sorts the cards in each Board column and the rows in each
 * List group; the List's headings change the same sort.
 */
export function SortButton({ sort, onChange }: SortButtonProps) {
	const label = getSortLabel(sort.sort);
	return (
		<Popover>
			<PopoverTrigger className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line-2 bg-raised ps-2.5 pe-2 text-[13px] whitespace-nowrap text-ink transition-colors duration-quick outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent data-popup-open:border-accent data-popup-open:ring-1 data-popup-open:ring-accent">
				<Icon name={directionIcon(sort.dir)} size={16} className="text-ink-2" />
				<Trans>Sort: {label}</Trans>
				<Icon name="caret-down" size={13} className="text-ink-3" />
			</PopoverTrigger>
			<PopoverContent align="end" sideOffset={6} className="w-[250px] gap-0 p-1.5">
				<div className="flex items-baseline justify-between px-2 pt-1 pb-1.5 text-xs font-medium text-ink-3">
					<Trans>Sort by</Trans>
					<span className="font-normal">
						<Trans>in each stage</Trans>
					</span>
				</div>
				<SortChoices sort={sort} onChange={onChange} />
			</PopoverContent>
		</Popover>
	);
}

/** On phones: an icon button after Filters that opens the same choices in a sheet. */
export function PhoneSortButton({ sort, onChange }: SortButtonProps) {
	const [open, setOpen] = useState(false);
	const label = getSortLabel(sort.sort);
	return (
		<>
			<Button
				size="icon"
				variant="secondary"
				aria-label={t`Sort: ${label}`}
				onClick={() => setOpen(true)}
				className="shrink-0"
			>
				<Icon name={directionIcon(sort.dir)} size={18} />
			</Button>
			<Sheet open={open} onOpenChange={setOpen}>
				<SheetContent side="bottom" showCloseButton={false} className="gap-0">
					<div className="flex items-center justify-between border-b border-line px-4 pt-1.5 pb-2.5">
						<SheetTitle className="font-sans text-[17px] leading-6 font-bold">
							<Trans>Sort</Trans>
						</SheetTitle>
						<span className="text-[13px] text-ink-3">
							<Trans>in each stage</Trans>
						</span>
					</div>
					<div className="px-2 pt-1.5 pb-2">
						<SortChoices sort={sort} onChange={onChange} large />
					</div>
					<div className="border-t border-line px-4 pt-3 pb-[calc(22px+env(safe-area-inset-bottom))]">
						<Button className="h-[42px] w-full" onClick={() => setOpen(false)}>
							<Trans>Done</Trans>
						</Button>
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
}
