import type { FilterContext, FilterFacet } from "../../filter";
import type { Application } from "../../types";
import type { ApplicationFilters } from "@reactive-resume/schema/applications/filters";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import {
	clearAll,
	clearFacet,
	EXTRA_FACETS,
	getFacetLabel,
	isDefaultFilters,
	isFacetSet,
	PRIMARY_FACETS,
	summary,
	valuesInUse,
} from "../../filter";
import { FilterButton } from "./filter-button";
import { FilterPanel } from "./filter-panel";

export type FilterBarProps = {
	/** Every application, for the options and their counts. */
	applications: readonly Application[];
	filters: ApplicationFilters;
	onChange: (filters: ApplicationFilters) => void;
	context: FilterContext;
	lanes: readonly string[];
	/** How many match, for "6 of 180". */
	matching: number;
	className?: string;
};

const WIDE: ReadonlySet<FilterFacet> = new Set(["lane", "fit", "tags"]);

const EXTRA_ICONS: Record<(typeof EXTRA_FACETS)[number], IconName> = {
	source: "globe-simple",
	documents: "file-text",
	attention: "bell",
	dates: "calendar-blank",
	tags: "tag",
};

/**
 * The filter buttons after the search box: Stage, Build, Found by, Lane, Fit, any set "More filters" ones, then More
 * filters, and "6 of 180" with Clear all once anything differs from the default. It's one flex item, so on a narrow
 * window it moves to its own line as a group and the search box keeps its width.
 */
export function FilterBar({ applications, filters, onChange, context, lanes, matching, className }: FilterBarProps) {
	const [open, setOpen] = useState<FilterFacet | null>(null);
	// Extra filters picked from More filters; each stays while it's set or open.
	const [added, setAdded] = useState<FilterFacet[]>([]);

	const extras = EXTRA_FACETS.filter((facet) => isFacetSet(filters, facet) || added.includes(facet));
	const notShown = EXTRA_FACETS.filter((facet) => !extras.includes(facet));

	const setOpenFacet = (facet: FilterFacet, next: boolean) => {
		// Opening another filter closes this one; the two events can come in either order.
		setOpen((current) => (next ? facet : current === facet ? null : current));
		if (!next) setAdded((current) => current.filter((item) => item !== facet));
	};

	const extraHint = (facet: (typeof EXTRA_FACETS)[number]) => {
		switch (facet) {
			case "source": {
				const used = valuesInUse(applications, "source");
				return used.length ? `${used.slice(0, 2).join(", ")}${used.length > 2 ? "…" : ""}` : "";
			}
			case "documents":
				return t`Resume, cover letter`;
			case "attention":
				return t`No reply, questions…`;
			case "dates":
				return t`Added, updated`;
			case "tags":
				return t`+ and −`;
		}
	};

	const button = (facet: FilterFacet) => {
		const active = isFacetSet(filters, facet);
		return (
			<FilterButton
				key={facet}
				label={getFacetLabel(facet)}
				value={summary(filters, facet, { noReplyDays: context.noReplyDays })}
				active={active}
				open={open === facet}
				onOpenChange={(next) => setOpenFacet(facet, next)}
				onClear={() => {
					onChange(clearFacet(filters, facet));
					setOpenFacet(facet, false);
				}}
				wide={WIDE.has(facet)}
			>
				<FilterPanel
					facet={facet}
					filters={filters}
					onChange={onChange}
					applications={applications}
					context={context}
					lanes={lanes}
				/>
			</FilterButton>
		);
	};

	return (
		<div className={cn("flex min-w-0 flex-auto flex-wrap items-center gap-1.5", className)}>
			{PRIMARY_FACETS.map(button)}
			{extras.map(button)}
			{notShown.length > 0 && (
				<DropdownMenu>
					<DropdownMenuTrigger className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] whitespace-nowrap text-ink-2 transition-colors hover:bg-hover hover:text-ink data-popup-open:ring-1 data-popup-open:ring-accent">
						<Icon name="plus" size={14} />
						<Trans>More filters</Trans>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-72">
						{notShown.map((facet) => (
							<DropdownMenuItem
								key={facet}
								onClick={() => {
									setAdded((current) => [...current, facet]);
									// Open the new button's popover once the menu has closed and handed focus back.
									window.setTimeout(() => setOpen(facet), 0);
								}}
							>
								<Icon name={EXTRA_ICONS[facet]} size={16} className="text-ink-3" />
								<span className="whitespace-nowrap">{getFacetLabel(facet)}</span>
								<span className="ms-auto truncate text-[11.5px] text-ink-3">{extraHint(facet)}</span>
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			)}
			{!isDefaultFilters(filters) && (
				<span className="ms-auto inline-flex items-center gap-2.5 ps-1.5 text-[13px] whitespace-nowrap">
					<span className="text-ink-2 tabular-nums">
						<Trans>
							<b className="font-semibold text-ink">{matching}</b> of {applications.length}
						</Trans>
					</span>
					<button
						type="button"
						onClick={() => {
							setAdded([]);
							onChange(clearAll());
						}}
						className="text-accent-text hover:underline"
					>
						<Trans>Clear all</Trans>
					</button>
				</span>
			)}
		</div>
	);
}
