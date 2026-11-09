import type {
	BuildFilterValue,
	FilterContext,
	FilterFacet,
	FilterOption,
	FiltersChange,
	ListFacet,
} from "../../filter";
import type { Application } from "../../types";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { ApplicationFilters } from "@reactive-resume/schema/applications/filters";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { APPLICATION_STATUSES } from "@reactive-resume/schema/applications/data";
import { DOCUMENT_FILTER_VALUES, OPEN_STAGES } from "@reactive-resume/schema/applications/filters";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { cn } from "@reactive-resume/utils/style";
import {
	clearFacet,
	facetOptions,
	markTag,
	matchesFilters,
	numberFieldText,
	reviewerFitValue,
	reviewerSlots,
	tagMark,
	toggleStage,
	toggleValue,
	withReviewerFit,
} from "../../filter";
import { getStageColor } from "../../stages";
import { NumberFilterField } from "./number-filter-field";

export type FilterPanelProps = {
	facet: FilterFacet;
	filters: ApplicationFilters;
	onChange: FiltersChange;
	applications: readonly Application[];
	context: FilterContext;
	/** The lanes from Preferences. */
	lanes: readonly string[];
	/** Closes the popover (Enter in a number field). */
	onDone?: () => void;
};

export const documentLabel = (value: (typeof DOCUMENT_FILTER_VALUES)[number]) =>
	({ any: t`Any`, linked: t`Linked`, none: t`None` })[value];

/** The Fit and Dates fields' labels for screen readers; the rows show "≥" and "In the last … days". */
export const numberFieldLabel = (key: "fit" | "tfit" | "added" | "updated") =>
	({
		fit: t`Lowest search fit`,
		tfit: t`Lowest targeting fit`,
		added: t`Days since added`,
		updated: t`Days since updated`,
	})[key];

/** A reviewer's fit field label for screen readers. */
export const reviewerFieldLabel = (slot: string) => t`Lowest fit from reviewer ${slot}`;

type ReviewerLabelProps = { slot: string; model: string };

/** A reviewer row's label: the slot ("B"), then the model it used last ("GPT"). */
export function ReviewerLabel({ slot, model }: ReviewerLabelProps) {
	return (
		<span className="flex min-w-0 items-baseline gap-2">
			<span className="font-semibold">{slot}</span>
			{model && <span className="truncate text-xs text-ink-3">{model}</span>}
		</span>
	);
}

type NumberRowProps = {
	label: ReactNode;
	/** A line under the label. */
	hint?: ReactNode;
	/** Set in under the row above (the reviewers under Targeting fit). */
	indent?: boolean;
	/** Shows ≥ before the field (the fits). */
	sign?: boolean;
	field: ReactNode;
	/** After the field ("days"). */
	unit?: ReactNode;
	/** How many show; null leaves the place empty. */
	count: number | null;
};

/** One Fit or Dates row: the label, ≥ for a fit, the field, its unit, then how many show once the field holds a number. */
function NumberRow({ label, hint, indent, sign, field, unit, count }: NumberRowProps) {
	return (
		<div className={cn("flex min-h-9 items-center gap-2 py-0.5 pe-2", indent ? "ps-5" : "ps-2")}>
			<span className="grid min-w-0 flex-1">
				<span className="truncate">{label}</span>
				{hint && <span className="text-xs text-ink-3">{hint}</span>}
			</span>
			{sign && (
				<span aria-hidden="true" className="text-base text-ink-3">
					≥
				</span>
			)}
			{field}
			{unit && <span className="whitespace-nowrap text-ink-2">{unit}</span>}
			<span className="w-8 text-end font-mono text-xs text-ink-3">{count ?? ""}</span>
		</div>
	);
}

/** Build statuses with the cards' icons and colors; no second checkbox for Not queued and Queued, a ring instead. */
export function BuildMark({ value, label }: { value: BuildFilterValue; label: string }) {
	switch (value) {
		case "none":
			return (
				<span className="inline-flex items-center gap-[7px]">
					<span aria-hidden="true" className="size-[13px] rounded-full border-[1.5px] border-dashed border-ink-3" />
					{label}
				</span>
			);
		case "build":
			return (
				<span className="inline-flex items-center gap-[7px] text-accent-text">
					<span aria-hidden="true" className="size-[13px] rounded-full border-4 border-accent" />
					{label}
				</span>
			);
		case "building":
			return (
				<span className="inline-flex items-center gap-[7px] text-warn-text">
					<Icon name="circle-notch" size={13} />
					{label}
				</span>
			);
		case "built":
			return (
				<span className="inline-flex items-center gap-[7px] text-emerald-600 dark:text-emerald-400">
					<Icon name="check-circle" filled size={13} />
					{label}
				</span>
			);
		case "failed":
			return (
				<span className="inline-flex items-center gap-[7px] text-danger-text">
					<Icon name="x-circle" filled size={13} />
					{label}
				</span>
			);
	}
}

type OptionRowProps = {
	checked: boolean;
	count: number;
	onToggle: () => void;
	children: ReactNode;
};

function OptionRow({ checked, count, onToggle, children }: OptionRowProps) {
	return (
		<label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 select-none hover:bg-hover">
			<Checkbox checked={checked} onCheckedChange={onToggle} />
			<span className={cn("flex min-w-0 items-center gap-1.5", count === 0 && !checked && "text-ink-3")}>
				{children}
			</span>
			<span className="ms-auto font-mono text-xs text-ink-3">{count}</span>
		</label>
	);
}

function Heading({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
	return (
		<div className="mx-2 my-1.5 flex items-baseline justify-between gap-2 text-xs font-medium text-ink-3">
			<span>{children}</span>
			{hint && <span className="font-normal">{hint}</span>}
		</div>
	);
}

type SegmentsProps<T extends string> = {
	label: string;
	value: T;
	values: readonly T[];
	labelOf: (value: T) => string;
	onChange: (value: T) => void;
};

function Segments<T extends string>({ label, value, values, labelOf, onChange }: SegmentsProps<T>) {
	return (
		<SegmentedControl
			aria-label={label}
			value={value}
			onValueChange={(next) => onChange(next as T)}
			className="mx-2 mb-2 flex h-8"
		>
			{values.map((item) => (
				<SegmentedControlItem key={item} value={item} className="px-1.5 text-xs">
					{labelOf(item)}
				</SegmentedControlItem>
			))}
		</SegmentedControl>
	);
}

function Footer({ children, onClear }: { children?: ReactNode; onClear?: () => void }) {
	return (
		<>
			<div className="mx-0.5 my-1.5 h-px bg-line" />
			<div className="flex items-center justify-between gap-2 px-2 pt-1 pb-0.5 text-xs">
				{children ?? <span />}
				{onClear && (
					<button type="button" onClick={onClear} className="text-accent-text hover:underline">
						<Trans>Clear</Trans>
					</button>
				)}
			</div>
		</>
	);
}

const LinkButton = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
	<button type="button" onClick={onClick} className="whitespace-nowrap text-accent-text hover:underline">
		{children}
	</button>
);

/** One filter's popover body, as drawn in the mockup: checkbox lists with counts, segmented rows, or the tag list. */
export function FilterPanel({ facet, filters, onChange, applications, context, lanes, onDone }: FilterPanelProps) {
	const options = (list: ListFacet) => facetOptions(list, { applications, filters, context, lanes });
	const clear = () => onChange(clearFacet(filters, facet));
	/** How many show with these filters, changed by `patch`. */
	const countWith = (patch: Partial<ApplicationFilters>) => {
		const next = { ...filters, ...patch };
		return applications.filter((application) => matchesFilters(application, next, context)).length;
	};
	const setNumber = (key: "fit" | "tfit" | "added" | "updated", value: string, replace: boolean) =>
		onChange({ ...filters, [key]: value }, { replace });

	const fitField = (key: "fit" | "tfit") => (
		<NumberFilterField
			value={filters[key]}
			kind="fit"
			label={numberFieldLabel(key)}
			onChange={(value, replace) => setNumber(key, value, replace)}
			initialFocus={key === "fit"}
			{...(onDone ? { onDone } : {})}
		/>
	);
	/** How many show, once the row's field holds a number. */
	const filledCount = (value: string) => (numberFieldText(value) ? countWith({}) : null);

	const dayRow = (key: "added" | "updated", label: ReactNode) => (
		<NumberRow
			label={label}
			field={
				<NumberFilterField
					value={filters[key]}
					kind="days"
					label={numberFieldLabel(key)}
					onChange={(value, replace) => setNumber(key, value, replace)}
					initialFocus={key === "added"}
					{...(onDone ? { onDone } : {})}
				/>
			}
			unit={<Trans>days</Trans>}
			count={filledCount(filters[key])}
		/>
	);

	switch (facet) {
		case "stage":
			return (
				<>
					{/* toggleStage keeps the last ticked stage, so Stage is never empty. */}
					{options("stage").map((option) => {
						const stage = option.value as ApplicationStatus;
						const checked = filters.stage.includes(stage);
						return (
							<OptionRow
								key={stage}
								checked={checked}
								count={option.count}
								onToggle={() => onChange({ ...filters, stage: toggleStage(filters.stage, stage) })}
							>
								<span
									aria-hidden="true"
									className="size-2 shrink-0 rounded-full"
									style={{ background: getStageColor(stage) }}
								/>
								<span className="truncate">{option.label}</span>
							</OptionRow>
						);
					})}
					<Footer>
						<LinkButton onClick={() => onChange({ ...filters, stage: [...OPEN_STAGES] })}>
							<Trans>Open stages</Trans>
						</LinkButton>
						<LinkButton onClick={() => onChange({ ...filters, stage: [...APPLICATION_STATUSES] })}>
							<Trans>All stages</Trans>
						</LinkButton>
					</Footer>
				</>
			);

		case "build":
			return (
				<>
					{options("build").map((option) => {
						const value = option.value as BuildFilterValue;
						return (
							<OptionRow
								key={value}
								checked={filters.build.includes(value)}
								count={option.count}
								onToggle={() => onChange({ ...filters, build: toggleValue(filters.build, value) })}
							>
								<BuildMark value={value} label={option.label} />
							</OptionRow>
						);
					})}
					<Footer onClear={clear} />
				</>
			);

		case "foundBy":
		case "source":
		case "attention":
			return (
				<>
					<ValueList facet={facet} options={options(facet)} filters={filters} onChange={onChange} />
					<Footer onClear={clear} />
				</>
			);

		case "lane":
			return (
				<>
					<ValueList facet="lane" options={options("lane")} filters={filters} onChange={onChange} />
					<div className="mx-0.5 my-1.5 h-px bg-line" />
					<Heading>
						<Trans>Match</Trans>
					</Heading>
					<Segments
						label={t`Match`}
						value={filters.laneMode}
						values={["either", "primary"] as const}
						labelOf={(value) => (value === "either" ? t`Either lane` : t`Primary only`)}
						onChange={(laneMode) => onChange({ ...filters, laneMode })}
					/>
					<div className="flex items-center justify-between gap-2 px-2 pt-1 pb-0.5 text-xs">
						<Link to="/dashboard/career/knowledge/preferences" className="text-accent-text hover:underline">
							{lanes.length ? <Trans>Edit lanes in Preferences</Trans> : <Trans>Add your lanes in Preferences</Trans>}
						</Link>
						<LinkButton onClick={clear}>
							<Trans>Clear</Trans>
						</LinkButton>
					</div>
				</>
			);

		case "fit":
			return (
				<>
					<NumberRow
						label={<Trans>Search fit</Trans>}
						hint={t`the search's read of the posting`}
						sign
						field={fitField("fit")}
						count={filledCount(filters.fit)}
					/>
					<div className="mx-0.5 my-1 h-px bg-line" />
					<NumberRow
						label={<Trans>Targeting fit</Trans>}
						hint={t`the reviewers' median, after a build`}
						sign
						field={fitField("tfit")}
						count={filledCount(filters.tfit)}
					/>
					{reviewerSlots(applications).map(({ slot, model }) => {
						const value = reviewerFitValue(filters, slot);
						return (
							<NumberRow
								key={slot}
								indent
								label={<ReviewerLabel slot={slot} model={model} />}
								sign
								field={
									<NumberFilterField
										value={value}
										kind="fit"
										label={reviewerFieldLabel(slot)}
										onChange={(next, replace) => onChange(withReviewerFit(filters, slot, next), { replace })}
										{...(onDone ? { onDone } : {})}
									/>
								}
								count={filledCount(value)}
							/>
						);
					})}
					<Footer onClear={clear} />
				</>
			);

		case "documents":
			return (
				<>
					<Heading>
						<Trans>Resume</Trans>
					</Heading>
					<Segments
						label={t`Resume`}
						value={filters.resume}
						values={DOCUMENT_FILTER_VALUES}
						labelOf={documentLabel}
						onChange={(resume) => onChange({ ...filters, resume })}
					/>
					<Heading>
						<Trans>Cover letter</Trans>
					</Heading>
					<Segments
						label={t`Cover letter`}
						value={filters.letter}
						values={DOCUMENT_FILTER_VALUES}
						labelOf={documentLabel}
						onChange={(letter) => onChange({ ...filters, letter })}
					/>
					<Footer onClear={clear} />
				</>
			);

		case "dates":
			return (
				<>
					<Heading>
						<Trans>In the last</Trans>
					</Heading>
					{dayRow("added", <Trans>Added</Trans>)}
					{dayRow("updated", <Trans>Updated</Trans>)}
					<Footer onClear={clear} />
				</>
			);

		case "tags":
			return <TagsPanel options={options("tags")} filters={filters} onChange={onChange} onClear={clear} />;
	}
}

type ValueListProps = {
	facet: "foundBy" | "source" | "attention" | "lane";
	options: FilterOption[];
	filters: ApplicationFilters;
	onChange: (filters: ApplicationFilters) => void;
};

function ValueList({ facet, options, filters, onChange }: ValueListProps) {
	const selected: readonly string[] = filters[facet];
	return (
		<div className="max-h-72 overflow-y-auto">
			{options.map((option) => (
				<OptionRow
					key={option.value}
					checked={selected.some((value) => value.toLocaleLowerCase() === option.value.toLocaleLowerCase())}
					count={option.count}
					onToggle={() => onChange({ ...filters, [facet]: toggleValue(selected, option.value) })}
				>
					<span className="truncate">{option.label}</span>
				</OptionRow>
			))}
		</div>
	);
}

type TagsPanelProps = {
	options: FilterOption[];
	filters: ApplicationFilters;
	onChange: (filters: ApplicationFilters) => void;
	onClear: () => void;
};

function TagsPanel({ options, filters, onChange, onClear }: TagsPanelProps) {
	const [query, setQuery] = useState("");
	const text = query.trim().toLocaleLowerCase();
	const shown = options.filter((option) => option.value.toLocaleLowerCase().includes(text));

	return (
		<>
			<div className="relative m-0.5 mb-1.5">
				<Icon
					name="magnifying-glass"
					size={15}
					className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3"
				/>
				<Input
					type="search"
					aria-label={t`Search tags`}
					placeholder={t`Search tags`}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					className="h-[30px] ps-7 text-[12.5px]"
				/>
			</div>
			{filters.tag.length > 1 && (
				<Segments
					label={t`Match the + tags`}
					value={filters.tagMode}
					values={["any", "all"] as const}
					labelOf={(value) => (value === "any" ? t`Any of the + tags` : t`All of them`)}
					onChange={(tagMode) => onChange({ ...filters, tagMode })}
				/>
			)}
			<div className="max-h-52 overflow-y-auto">
				{shown.length === 0 && (
					<p className="px-2 py-1.5 text-ink-3">
						{options.length === 0 ? <Trans>No tags yet.</Trans> : <Trans>No tags match.</Trans>}
					</p>
				)}
				{shown.map((option) => {
					const mark = tagMark(filters, option.value);
					return (
						<div key={option.value} className="flex items-center gap-2 rounded-md py-1 ps-2 pe-1 hover:bg-hover">
							<span
								className={cn(
									"min-w-0 flex-1 truncate",
									mark === "in" && "font-semibold text-accent-text",
									mark === "out" && "text-danger-text line-through",
									!mark && option.count === 0 && "text-ink-3",
								)}
							>
								{option.label}
							</span>
							<span className="w-[22px] text-end font-mono text-xs text-ink-3">{option.count}</span>
							<span className="inline-flex overflow-hidden rounded-md border border-line-2">
								<button
									type="button"
									aria-pressed={mark === "in"}
									aria-label={t`Must have ${option.label}`}
									title={t`Must have`}
									onClick={() => onChange(markTag(filters, option.value, "in"))}
									className={cn(
										"grid h-[22px] w-6 place-items-center text-ink-3",
										mark === "in" ? "bg-accent text-on-accent" : "hover:bg-hover",
									)}
								>
									<Icon name="plus" size={14} />
								</button>
								<button
									type="button"
									aria-pressed={mark === "out"}
									aria-label={t`Must not have ${option.label}`}
									title={t`Must not have`}
									onClick={() => onChange(markTag(filters, option.value, "out"))}
									className={cn(
										"grid h-[22px] w-6 place-items-center border-s border-line-2 text-ink-3",
										mark === "out" ? "bg-danger-text text-raised" : "hover:bg-hover",
									)}
								>
									<Icon name="minus" size={14} />
								</button>
							</span>
						</div>
					);
				})}
			</div>
			<Footer onClear={onClear}>
				<span className="text-ink-3">
					<Trans>+ must have, − must not</Trans>
				</span>
			</Footer>
		</>
	);
}
