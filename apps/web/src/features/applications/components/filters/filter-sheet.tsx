import type { FilterFacet, FilterOption, ListFacet } from "../../filter";
import type { FilterBarProps } from "./filter-bar";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useState } from "react";
import {
	DATE_FILTER_VALUES,
	DOCUMENT_FILTER_VALUES,
	SEARCH_FIT_FILTER_VALUES,
	TARGETING_FIT_FILTER_VALUES,
} from "@reactive-resume/schema/applications/filters";
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
	summary,
	tagMark,
	toggleStage,
	toggleValue,
} from "../../filter";
import { dateLabel, documentLabel, searchFitLabel, targetingFitLabel } from "./filter-panel";

type PillProps = { on: boolean; onClick: () => void; count?: number; tone?: "out"; children: ReactNode };

function Pill({ on, onClick, count, tone, children }: PillProps) {
	return (
		<button
			type="button"
			aria-pressed={on}
			onClick={onClick}
			className={cn(
				"inline-flex h-8 items-center gap-1.5 rounded-full border px-[11px] text-[13px] transition-colors",
				on
					? tone === "out"
						? "border-transparent bg-danger-soft font-semibold text-danger-text line-through"
						: "border-transparent bg-accent-soft font-semibold text-accent-text"
					: "border-line-2 text-ink",
			)}
		>
			{children}
			{count !== undefined && (
				<span className={cn("font-mono text-[11.5px]", on ? "text-current" : "text-ink-3")}>{count}</span>
			)}
		</button>
	);
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
	return (
		<section className="grid gap-2 pt-3 pb-1">
			<h3 className="flex justify-between text-[13px] font-semibold">
				{title}
				{hint && <span className="font-normal text-ink-3">{hint}</span>}
			</h3>
			<div className="flex flex-wrap gap-1.5">{children}</div>
		</section>
	);
}

/**
 * Phones: the Filters button with the number set, the set filters as chips under it (scrolling sideways, each with ×),
 * and a bottom sheet with every filter as tappable pills. Filters apply as they're tapped; "Show N applications" closes.
 */
export function PhoneFilters({ applications, filters, onChange, context, lanes, matching }: FilterBarProps) {
	const [open, setOpen] = useState(false);
	const count = activeFilterCount(filters);
	const set = FACETS.filter((facet) => isFacetSet(filters, facet));
	const options = (facet: ListFacet) => facetOptions(facet, { applications, filters, context, lanes });

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
					<div key={facet}>
						<Section title={t`Search fit`}>
							{choicePills(filters.fit, SEARCH_FIT_FILTER_VALUES, searchFitLabel, (fit) =>
								onChange({ ...filters, fit }),
							)}
						</Section>
						<Section title={t`Targeting fit`}>
							{choicePills(filters.tfit, TARGETING_FIT_FILTER_VALUES, targetingFitLabel, (tfit) =>
								onChange({ ...filters, tfit }),
							)}
						</Section>
					</div>
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
					<div key={facet}>
						<Section title={t`Added in the last`}>
							{choicePills(filters.added, DATE_FILTER_VALUES, dateLabel, (added) => onChange({ ...filters, added }))}
						</Section>
						<Section title={t`Updated in the last`}>
							{choicePills(filters.updated, DATE_FILTER_VALUES, dateLabel, (updated) =>
								onChange({ ...filters, updated }),
							)}
						</Section>
					</div>
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
					<span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-[5px] text-[11px] font-semibold text-on-accent">
						{count}
					</span>
				)}
			</Button>

			{set.length > 0 && (
				<div className="-mx-4 flex basis-full [scrollbar-width:none] gap-1.5 overflow-x-auto px-4 pb-0.5">
					{set.map((facet) => (
						<span
							key={facet}
							className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-accent-soft ps-2.5 pe-1.5 text-[12.5px] whitespace-nowrap text-accent-text"
						>
							{getFacetLabel(facet)}: <b className="font-semibold">{summary(filters, facet, context)}</b>
							<button
								type="button"
								aria-label={t`Clear ${getFacetLabel(facet)}`}
								onClick={() => onChange(clearFacet(filters, facet))}
								className="grid size-5 place-items-center"
							>
								<Icon name="x" size={12} />
							</button>
						</span>
					))}
				</div>
			)}
			{!isDefaultFilters(filters) && (
				<p className="basis-full text-[12.5px] text-ink-3">
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
					<div className="flex items-center justify-between border-b border-line px-4 pt-1.5 pb-2.5">
						<SheetTitle className="font-sans text-[17px] leading-6 font-bold">
							<Trans>Filters</Trans>
						</SheetTitle>
						<button type="button" onClick={() => onChange(clearAll())} className="text-accent-text">
							<Trans>Clear all</Trans>
						</button>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-3">
						{PRIMARY_FACETS.map(section)}
						<div className="mt-3 h-px bg-line" />
						{EXTRA_FACETS.map(section)}
					</div>
					<div className="flex gap-2.5 border-t border-line px-4 pt-3 pb-[calc(22px+env(safe-area-inset-bottom))]">
						<Button variant="secondary" className="h-[42px] w-[110px]" onClick={() => onChange(clearAll())}>
							<Trans>Clear all</Trans>
						</Button>
						<Button className="h-[42px] flex-1" onClick={() => setOpen(false)}>
							<Plural value={matching} one="Show # application" other="Show # applications" />
						</Button>
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
}
