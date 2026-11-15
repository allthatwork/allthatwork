import type { FilterFacet, FilterOption, ListFacet } from "../../filter";
import type { FilterBarProps } from "./filter-bar";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useState } from "react";
import { DOCUMENT_FILTER_VALUES } from "@reactive-resume/schema/applications/filters";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Sheet, SheetContent, SheetTitle } from "@reactive-resume/ui/components/sheet";
import { cn } from "@reactive-resume/utils/style";
import {
	activeFilterCount,
	clearAll,
	clearFacet,
	EXTRA_FACETS,
	facetOptions,
	FACETS,
	getFacetLabel,
	isDefaultFilters,
	isFacetSet,
	markTag,
	PRIMARY_FACETS,
	reviewerFitValue,
	reviewerSlots,
	summary,
	tagMark,
	toggleStage,
	toggleValue,
	withReviewerFit,
} from "../../filter";
import { phoneSheetFooterClassName, phoneSheetHeaderClassName } from "../phone-sheet";
import { documentLabel, numberFieldLabel, ReviewerLabel, reviewerFieldLabel } from "./filter-panel";
import { NumberFilterField } from "./number-filter-field";
import { Chip } from "@/components/calm/filter-bar";

type PillProps = {
	on: boolean;
	onClick: () => void;
	count?: number;
	tone?: "out";
	className?: string;
	children: ReactNode;
};

/** Calm's chip, at 36px for a thumb: a quiet outline, the accent tint once picked (danger for an excluded tag). */
function Pill({ on, onClick, count, tone, className, children }: PillProps) {
	return (
		<Chip
			pressed={on}
			onClick={onClick}
			className={cn(
				"h-9 px-3 text-sm",
				on && "font-semibold",
				on && tone === "out" && "bg-danger-soft text-danger-text line-through hover:text-danger-text",
				className,
			)}
		>
			{children}
			{count !== undefined && (
				<span className={cn("font-mono text-xs", on ? "text-current" : "text-ink-3")}>{count}</span>
			)}
		</Chip>
	);
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
	return (
		<section className="grid gap-2.5 pt-4 pb-1">
			<h3 className="flex items-baseline justify-between gap-3 t-section-heading">
				{title}
				{hint && <span className="text-[13px]/[18px] font-normal text-ink-3">{hint}</span>}
			</h3>
			<div className="flex flex-wrap gap-2">{children}</div>
		</section>
	);
}

/**
 * Phones: the Filters button with the number set, the set filters as chips under it (scrolling sideways, each with ×),
 * and a bottom sheet with every filter as tappable pills. Filters apply as they're tapped; "Show N applications" closes.
 */
type PhoneFiltersProps = FilterBarProps & {
	/** Shown right after the Filters button, before the chips (the Sort button). */
	trailing?: ReactNode;
};

export function PhoneFilters({
	applications,
	filters,
	onChange,
	context,
	lanes,
	matching,
	trailing,
}: PhoneFiltersProps) {
	const [open, setOpen] = useState(false);
	const count = activeFilterCount(filters);
	const set = FACETS.filter((facet) => isFacetSet(filters, facet));
	const options = (facet: ListFacet) => facetOptions(facet, { applications, filters, context, lanes });
	const setNumber = (key: "fit" | "tfit" | "added" | "updated", value: string, replace: boolean) =>
		onChange({ ...filters, [key]: value }, { replace });

	// The same fields as the popovers, sized for touch, with the phone's number keypad.
	const numberField = (key: "fit" | "tfit" | "added" | "updated") => (
		<NumberFilterField
			value={filters[key]}
			kind={key === "fit" || key === "tfit" ? "fit" : "days"}
			label={numberFieldLabel(key)}
			onChange={(value, replace) => setNumber(key, value, replace)}
			className="h-11 w-16 rounded-md text-base"
		/>
	);

	/** One Fit or Dates row: the label, ≥ for a fit, the field, its unit. */
	const numberRow = (
		label: ReactNode,
		field: ReactNode,
		options: { sign?: boolean; unit?: ReactNode; indent?: boolean },
	) => (
		<div className={cn("flex basis-full items-center gap-2.5", options.indent && "ps-4")}>
			<span className="min-w-0 flex-1 text-[15px]/[22px] text-ink-2">{label}</span>
			{options.sign && (
				<span aria-hidden="true" className="text-base text-ink-3">
					≥
				</span>
			)}
			{field}
			{options.unit && <span className="w-9 text-sm text-ink-2">{options.unit}</span>}
		</div>
	);

	const valuePills = (facet: "build" | "foundBy" | "lane" | "source" | "attention", list: FilterOption[]) =>
		list.map((option) => {
			const selected: readonly string[] = filters[facet];
			return (
				<Pill
					key={option.value}
					on={selected.some((value) => value.toLocaleLowerCase() === option.value.toLocaleLowerCase())}
					count={option.count}
					onClick={() => onChange({ ...filters, [facet]: toggleValue(selected, option.value) })}
				>
					{option.label}
				</Pill>
			);
		});

	const choicePills = <T extends string>(
		value: T,
		values: readonly T[],
		labelOf: (value: T) => string,
		pick: (value: T) => void,
	) =>
		values.map((item) => (
			<Pill key={item} on={value === item} onClick={() => pick(item)}>
				{labelOf(item)}
			</Pill>
		));

	const section = (facet: FilterFacet): ReactNode => {
		switch (facet) {
			case "stage":
				return (
					<Section key={facet} title={getFacetLabel(facet)}>
						{options("stage").map((option) => {
							const stage = option.value as ApplicationStatus;
							return (
								<Pill
									key={stage}
									on={filters.stage.includes(stage)}
									count={option.count}
									onClick={() => onChange({ ...filters, stage: toggleStage(filters.stage, stage) })}
								>
									{option.label}
								</Pill>
							);
						})}
					</Section>
				);
			case "build":
			case "foundBy":
			case "source":
			case "attention":
				return (
					<Section key={facet} title={getFacetLabel(facet)}>
						{valuePills(facet, options(facet))}
					</Section>
				);
			case "lane":
				return (
					<Section
						key={facet}
						title={getFacetLabel(facet)}
						hint={filters.laneMode === "either" ? t`either lane` : t`primary only`}
					>
						{valuePills("lane", options("lane"))}
						<span className="basis-full" />
						{choicePills(
							filters.laneMode,
							["either", "primary"] as const,
							(value) => (value === "either" ? t`Either lane` : t`Primary only`),
							(laneMode) => onChange({ ...filters, laneMode }),
						)}
					</Section>
				);
			case "fit":
				return (
					<Section key={facet} title={getFacetLabel(facet)}>
						{numberRow(<Trans>Search fit</Trans>, numberField("fit"), { sign: true })}
						{numberRow(<Trans>Targeting fit</Trans>, numberField("tfit"), { sign: true })}
						{reviewerSlots(applications).map(({ slot, model }) => (
							<div key={slot} className="contents">
								{numberRow(
									<ReviewerLabel slot={slot} model={model} />,
									<NumberFilterField
										value={reviewerFitValue(filters, slot)}
										kind="fit"
										label={reviewerFieldLabel(slot)}
										onChange={(value, replace) => onChange(withReviewerFit(filters, slot, value), { replace })}
										className="h-11 w-16 rounded-md text-base"
									/>,
									{ sign: true, indent: true },
								)}
							</div>
						))}
					</Section>
				);
			case "documents":
				return (
					<div key={facet}>
						<Section title={t`Resume`}>
							{choicePills(filters.resume, DOCUMENT_FILTER_VALUES, documentLabel, (resume) =>
								onChange({ ...filters, resume }),
							)}
						</Section>
						<Section title={t`Cover letter`}>
							{choicePills(filters.letter, DOCUMENT_FILTER_VALUES, documentLabel, (letter) =>
								onChange({ ...filters, letter }),
							)}
						</Section>
					</div>
				);
			case "dates":
				return (
					<Section key={facet} title={getFacetLabel(facet)} hint={t`in the last`}>
						{numberRow(<Trans>Added</Trans>, numberField("added"), { unit: <Trans>days</Trans> })}
						{numberRow(<Trans>Updated</Trans>, numberField("updated"), { unit: <Trans>days</Trans> })}
					</Section>
				);
			case "tags": {
				const tags = options("tags");
				if (tags.length === 0) return null;
				return (
					<Section key={facet} title={getFacetLabel(facet)} hint={t`tap: + must have, again: − must not`}>
						{tags.map((option) => {
							const mark = tagMark(filters, option.value);
							return (
								<Pill
									key={option.value}
									on={mark !== null}
									{...(mark === "out" ? { tone: "out" as const } : {})}
									count={option.count}
									// Off, then must have, then must not, then off again.
									onClick={() =>
										onChange(
											mark === "out"
												? markTag(filters, option.value, "out")
												: markTag(filters, option.value, mark === "in" ? "out" : "in"),
										)
									}
								>
									{mark === "in" ? "+ " : mark === "out" ? "− " : ""}
									{option.label}
								</Pill>
							);
						})}
					</Section>
				);
			}
		}
	};

	return (
		<>
			<Button variant="secondary" onClick={() => setOpen(true)} className="shrink-0">
				<Icon name="funnel" size={16} />
				<Trans>Filters</Trans>
				{count > 0 && (
					<span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-[5px] text-xs font-semibold text-on-accent">
						{count}
					</span>
				)}
			</Button>
			{trailing}

			{set.length > 0 && (
				<div className="-mx-4 flex basis-full [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-0.5">
					{set.map((facet) => (
						<span
							key={facet}
							data-slot="chip"
							className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm bg-accent-soft ps-2.5 pe-1.5 text-[13px]/[18px] font-medium whitespace-nowrap text-accent-text"
						>
							{getFacetLabel(facet)}: <b className="font-semibold">{summary(filters, facet, context)}</b>
							<button
								type="button"
								aria-label={t`Clear ${getFacetLabel(facet)}`}
								onClick={() => onChange(clearFacet(filters, facet))}
								className="touch-target relative grid size-5 place-items-center rounded-xs"
							>
								<Icon name="x" size={14} />
							</button>
						</span>
					))}
				</div>
			)}
			{!isDefaultFilters(filters) && (
				<p className="basis-full text-[13px]/[18px] text-ink-3">
					<Trans>
						<b className="font-semibold text-ink">{matching}</b> of {applications.length}
					</Trans>
					{" · "}
					<button type="button" onClick={() => onChange(clearAll())} className="text-accent-text hover:underline">
						<Trans>Clear all</Trans>
					</button>
				</p>
			)}

			<Sheet open={open} onOpenChange={setOpen}>
				<SheetContent side="bottom" showCloseButton={false} className="h-[86svh] gap-0">
					<div className={cn(phoneSheetHeaderClassName, "border-b border-line")}>
						<SheetTitle>
							<Trans>Filters</Trans>
						</SheetTitle>
						<button
							type="button"
							onClick={() => onChange(clearAll())}
							className="touch-target relative text-sm font-medium text-accent-text"
						>
							<Trans>Clear all</Trans>
						</button>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
						{PRIMARY_FACETS.map(section)}
						<div className="mt-4 h-px bg-line" />
						{EXTRA_FACETS.map(section)}
					</div>
					<div className={phoneSheetFooterClassName}>
						<Button variant="secondary" size="lg" onClick={() => onChange(clearAll())}>
							<Trans>Clear all</Trans>
						</Button>
						<Button size="lg" className="flex-1" onClick={() => setOpen(false)}>
							<Plural value={matching} one="Show # application" other="Show # applications" />
						</Button>
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
}
