import type { ShownSnapshot } from "@/features/applications/filter";
import type { Application } from "@/features/applications/types";
import type { ApplicationFilters, ApplicationSort } from "@reactive-resume/schema/applications/filters";
import type { ListColumn, ListColumnId } from "@reactive-resume/schema/applications/layout";
import type { ApplicationView } from "@reactive-resume/schema/applications/views";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import z from "zod";
import { DEFAULT_APPLICATION_SORT } from "@reactive-resume/schema/applications/filters";
import {
	DEFAULT_LIST_COLUMNS,
	resolveColumnsWithWidths,
	resolveListColumns,
} from "@reactive-resume/schema/applications/layout";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { FILL_SCREEN_ATTRIBUTE, PAGE_CLASS } from "@/components/layout/page";
import { AddApplicationDialog } from "@/features/applications/components/add-application-dialog";
import { ApplicationDetailSheet } from "@/features/applications/components/application-detail-sheet";
import { ApplicationFormSheet } from "@/features/applications/components/application-form-sheet";
import { ApplicationBoard } from "@/features/applications/components/board";
import { ApplicationCalendar } from "@/features/applications/components/calendar-view";
import { ColumnsButton } from "@/features/applications/components/columns-button";
import { ExportApplicationsSheet } from "@/features/applications/components/export-applications-sheet";
import { FilterBar } from "@/features/applications/components/filters/filter-bar";
import { PhoneFilters } from "@/features/applications/components/filters/filter-sheet";
import { ImportApplicationsSheet } from "@/features/applications/components/import-applications-sheet";
import { ApplicationInsights, InsightsSkeleton } from "@/features/applications/components/insights-view";
import { ApplicationList } from "@/features/applications/components/list-view";
import { PhoneSortButton, SortButton } from "@/features/applications/components/sort-button";
import { ManageViewsSheet } from "@/features/applications/components/views/manage-views-sheet";
import { SaveViewDialog } from "@/features/applications/components/views/save-view-dialog";
import { ViewsButton } from "@/features/applications/components/views/views-button";
import { clearAll, matchesFilters, mergeSnapshot, withHeld } from "@/features/applications/filter";
import {
	filterSearchShape,
	filtersFromSearch,
	searchFromFilters,
	sortFromSearch,
} from "@/features/applications/filter-search";
import { getNextStep, useNoReplyDays } from "@/features/applications/next-step";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { filtersOfView, isViewEdited, viewFiltersOf } from "@/features/applications/saved-views";
import { resizeColumnChange, useApplicationsLayout } from "@/features/applications/use-applications-layout";
import { useRememberedFilters } from "@/features/applications/use-remembered-filters";
import { isNameTaken, useSavedViews } from "@/features/applications/use-saved-views";
import { useTabLabels } from "@/features/applications/use-tab-labels";
import { ENTER_CLASS } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

const VIEWS = ["board", "list", "insights", "calendar"] as const;
type View = (typeof VIEWS)[number];

const searchSchema = z.object({
	view: z.enum(VIEWS).default("board").catch("board"),
	// Deep links: open Add, or one application.
	create: z.boolean().default(false).catch(false),
	applicationId: z.string().optional().catch(undefined),
	// The filters and the sort; each is left out of the address at its default.
	...filterSearchShape,
});
type Search = z.output<typeof searchSchema>;
const defaultSearch: Partial<Search> = { view: "board", create: false };

export const Route = createFileRoute("/dashboard/applications/")({
	component: RouteComponent,
	validateSearch: searchSchema,
	search: { middlewares: [stripSearchParams(defaultSearch)] },
});

const NO_SNAPSHOT: ShownSnapshot = new Map();

const NO_VIEW = { viewId: null, viewColumns: null };

function RouteComponent() {
	const search = Route.useSearch();
	const { view, create, applicationId } = search;
	const navigate = useNavigate({ from: Route.fullPath });
	const phone = useBreakpoint() === "mobile";
	const { filters: addressFilters } = filtersFromSearch(search);
	// The account's List columns, Board column width and sort. A sort in the address (a link) wins over the account's.
	const { layout, update: updateLayout } = useApplicationsLayout();
	// Saved views: the one that's on and its unsaved columns live in the tab's state, its filters and sort in the
	// address. With no view on, the sort and columns are the account's; with one on, they're the view's (a copy, so
	// changing them doesn't touch the account's). Column widths stay the account's either way.
	const savedViews = useSavedViews();
	const views = savedViews.views;
	const { viewId, viewColumns, setTabView } = useRememberedFilters({
		search,
		views,
		onRestore: (stored) =>
			void navigate({ replace: true, resetScroll: false, search: (prev: Search) => ({ ...prev, ...stored }) }),
	});
	const activeView = (viewId !== null && views?.find((item) => item.id === viewId)) || null;
	const inView = viewId !== null && (views === undefined || activeView !== null);
	const sort =
		sortFromSearch(search) ?? (inView ? DEFAULT_APPLICATION_SORT : (layout.sort ?? DEFAULT_APPLICATION_SORT));
	const accountColumns: ListColumn[] = layout.listColumns ?? DEFAULT_LIST_COLUMNS.map((id) => ({ id }));
	const columnIds: ListColumnId[] = inView
		? (viewColumns ?? activeView?.layout.listColumns ?? accountColumns.map((column) => column.id))
		: accountColumns.map((column) => column.id);
	// Typing filters at once; the address gets the text 300ms after typing stops.
	const [query, setQuery] = useState(addressFilters.q);
	const [addressQuery, setAddressQuery] = useState(addressFilters.q);
	if (addressFilters.q !== addressQuery) {
		// The address changed the search (Clear all, back, a restored tab): follow it, unless it's what was typed.
		setAddressQuery(addressFilters.q);
		if (addressFilters.q !== query.trim()) setQuery(addressFilters.q);
	}
	const filters: ApplicationFilters = { ...addressFilters, q: query };
	const [adding, setAdding] = useState(false);
	const [importing, setImporting] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [editing, setEditing] = useState<Application | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	// Views animate in only after a switch, never on the page's first render.
	const [viewSwitched, setViewSwitched] = useState(false);
	const [savingView, setSavingView] = useState(false);
	const [managingViews, setManagingViews] = useState(false);

	const { data: applications, isPending, isError, isFetching, refetch } = useQuery(applicationsListQueryOptions());
	const { data: profile } = useQuery(orpc.career.profile.queryOptions());
	const noReplyDays = useNoReplyDays();
	const [now] = useState(() => new Date());
	const context = { now, noReplyDays };

	const setSearch = (patch: Partial<Search>) =>
		void navigate({ resetScroll: false, search: (prev: Search) => ({ ...prev, ...patch }) });
	const setFilters = (next: ApplicationFilters) => {
		if (next.q !== query) setQuery(next.q);
		setSearch(searchFromFilters(next, sort));
	};
	const setSort = (next: ApplicationSort) => {
		// A view's sort is the view's until Update; the account's changes only with no view on.
		if (!inView) updateLayout({ sort: next });
		setSearch(searchFromFilters(filters, next));
	};
	// Columns: a view's on-screen copy while one is on, the account's otherwise.
	const setColumns = (next: ListColumn[]) =>
		inView ? setTabView({ viewId, viewColumns: next.map((column) => column.id) }) : updateLayout({ listColumns: next });
	const resetColumns = () =>
		inView ? setTabView({ viewId, viewColumns: [...DEFAULT_LIST_COLUMNS] }) : updateLayout({ listColumns: null });
	// Widths are the account's in every view; resizing never makes a view edited.
	const resizeColumn = (id: ListColumnId, width: number | null) => updateLayout(resizeColumnChange(layout, id, width));

	useEffect(() => {
		if (query.trim() === addressQuery) return;
		const timer = window.setTimeout(
			() =>
				void navigate({
					replace: true,
					resetScroll: false,
					search: (prev: Search) => ({ ...prev, q: query.trim() || undefined }),
				}),
			300,
		);
		return () => window.clearTimeout(timer);
	}, [query, addressQuery, navigate]);

	// Old links' ?closed=true: the stages already include Closed; write them out and drop the old param.
	const legacyClosed = search.closed !== undefined;
	useEffect(() => {
		if (!legacyClosed) return;
		void navigate({
			replace: true,
			resetScroll: false,
			search: (prev: Search) => {
				const { filters: mapped, sort: sorted } = filtersFromSearch(prev);
				return { ...prev, ...searchFromFilters(mapped, sorted), closed: undefined };
			},
		});
	}, [legacyClosed, navigate]);

	// A view deleted elsewhere (another tab) turns off; the filters stay and the sort goes back to the account's.
	const viewGone = viewId !== null && views !== undefined && activeView === null;
	useEffect(() => {
		if (!viewGone) return;
		setTabView(NO_VIEW);
		void navigate({
			replace: true,
			resetScroll: false,
			search: (prev: Search) => ({ ...prev, sort: undefined, dir: undefined }),
		});
	}, [viewGone, setTabView, navigate]);

	useEffect(() => {
		if (!create) return;
		// oxlint-disable-next-line react/set-state-in-effect -- takes the one-shot ?create flag from the address, then clears it
		setAdding(true);
		void navigate({ replace: true, resetScroll: false, search: (prev: Search) => ({ ...prev, create: false }) });
	}, [create, navigate]);

	useEffect(() => {
		if (!applicationId || !applications) return;
		// oxlint-disable-next-line react/set-state-in-effect -- takes the one-shot ?applicationId from the address, then clears it
		setSelectedId(applicationId);
		void navigate({
			replace: true,
			resetScroll: false,
			search: (prev: Search) => ({ ...prev, applicationId: undefined }),
		});
	}, [applicationId, applications, navigate]);

	// A card changed while filtered stays on screen, marked, until the filters change: the snapshot holds what was shown
	// since the last filter change, and starts again whenever they change.
	const filtersKey = JSON.stringify(filters);
	const isMatch = (application: Application) => matchesFilters(application, filters, context);
	const [snapshot, setSnapshot] = useState<{ key: string; shown: ShownSnapshot } | null>(null);
	const current = snapshot?.key === filtersKey ? snapshot.shown : NO_SNAPSHOT;
	const { matching, shown: visible, stale } = withHeld(applications ?? [], isMatch, current);
	const merged = applications ? mergeSnapshot(current, matching) : null;
	if (merged) setSnapshot({ key: filtersKey, shown: merged });

	const filterProps = {
		applications: applications ?? [],
		filters,
		onChange: setFilters,
		context,
		lanes: profile?.lanes ?? [],
		matching: matching.length,
	};

	// Saved views
	const edited = activeView ? isViewEdited(activeView, { filters, sort, columns: columnIds }) : false;
	const countOf = (view: ApplicationView | null) =>
		(applications ?? []).filter((application) =>
			matchesFilters(application, view ? filtersOfView(view) : clearAll(), context),
		).length;
	const failed = () => toast.add({ type: "error", description: t`Couldn't save the view. Try again.` });

	/** Picks a view, or All applications (null): its filters, sort and columns, and an empty search box. */
	const applyView = (next: ApplicationView | null) => {
		setQuery("");
		setTabView(next ? { viewId: next.id, viewColumns: null } : NO_VIEW);
		// All applications leaves the sort out of the address, so the account's applies.
		setSearch(
			next
				? searchFromFilters(filtersOfView(next), next.layout.sort)
				: searchFromFilters(clearAll(), DEFAULT_APPLICATION_SORT),
		);
	};
	/** Turns the view off and keeps the filters; the sort and columns go back to the account's. */
	const leaveViewKeepingFilters = () => {
		setTabView(NO_VIEW);
		setSearch({ sort: undefined, dir: undefined });
	};
	const viewLayout = () => ({ sort, listColumns: [...columnIds] });

	const saveNewView = async (name: string, isDefault: boolean) => {
		const created = await savedViews.create({ name, filters: viewFiltersOf(filters), layout: viewLayout(), isDefault });
		setTabView({ viewId: created.id, viewColumns: null });
		// With the view on, the sort lives in the address.
		setSearch(searchFromFilters(filters, sort));
		const saved = created.name;
		toast.add({ type: "success", description: t`Saved “${saved}”.` });
	};

	const updateActiveView = async () => {
		if (!activeView) return;
		const before = activeView;
		const name = before.name;
		try {
			await savedViews.update({ id: before.id, filters: viewFiltersOf(filters), layout: viewLayout() });
		} catch {
			return failed();
		}
		toast.add({
			type: "success",
			description: t`Updated “${name}”.`,
			actionProps: {
				children: t`Undo`,
				onClick: () =>
					void savedViews.update({ id: before.id, filters: before.filters, layout: before.layout }).catch(failed),
			},
		});
	};

	const renameView = async (view: ApplicationView, name: string) => {
		try {
			await savedViews.update({ id: view.id, name });
			return true;
		} catch (error) {
			if (isNameTaken(error)) toast.add({ type: "error", description: t`You already have a view called “${name}”.` });
			else failed();
			return false;
		}
	};

	const deleteView = async (view: ApplicationView) => {
		const index = (views ?? []).findIndex((item) => item.id === view.id);
		try {
			await savedViews.remove({ id: view.id });
		} catch {
			return failed();
		}
		if (view.id === viewId) leaveViewKeepingFilters();
		const name = view.name;
		const undo = async () => {
			try {
				const again = await savedViews.create({
					name: view.name,
					filters: view.filters,
					layout: view.layout,
					isDefault: view.isDefault,
				});
				// Back where it was in the list.
				const ids = savedViews.current().flatMap((item) => (item.id === again.id ? [] : [item.id]));
				ids.splice(index < 0 ? ids.length : index, 0, again.id);
				await savedViews.reorder({ ids });
			} catch (error) {
				if (isNameTaken(error)) toast.add({ type: "error", description: t`You already have a view called “${name}”.` });
				else failed();
			}
		};
		toast.add({ description: t`Deleted “${name}”.`, actionProps: { children: t`Undo`, onClick: () => void undo() } });
	};

	const viewsMenu = views && {
		views,
		active: activeView,
		edited,
		countOf,
		onPick: applyView,
		onUpdate: () => void updateActiveView(),
		onDiscard: () => applyView(activeView),
		onSaveNew: () => setSavingView(true),
		onManage: () => setManagingViews(true),
	};

	const selected = applications?.find((application) => application.id === selectedId) ?? null;
	// The board needs room to drag: phones get the list instead.
	const shown: View = phone && (view === "board" || view === "calendar") ? "list" : view;
	const empty = !!applications && applications.length === 0;
	const noMatches = !!applications && !empty && visible.length === 0;
	// In Board view the page is the window's height and the board takes what's left below the header, the nudge and the
	// toolbar; each column scrolls on its own. The other views scroll the page.
	const fill = shown === "board" && !empty && !(isError && !applications);
	// The tabs and the toolbar show once there are applications to look at.
	const withViews = !empty && !(isError && !applications);
	// The tabs beside the title go icon only when the title row can't hold their labels (measured).
	const showViewsButton = withViews && shown !== "insights" && Boolean(viewsMenu);
	const {
		labels: tabLabels,
		rowRef,
		titleRef,
		tabsRef,
		viewsRef,
		actionsRef,
	} = useTabLabels(withViews && !phone, showViewsButton ? `${activeView?.name ?? ""}${edited}` : "");

	const viewTabs = (
		<Tabs
			value={shown}
			onValueChange={(value) => {
				setViewSwitched(true);
				setSearch({ view: value as View });
			}}
		>
			<TabsList aria-label={t`View`}>
				{!phone && (
					<TabsTrigger value="board" title={tabLabels ? undefined : t`Board`}>
						<Icon name="kanban" size={18} />
						<span className={cn(!tabLabels && "sr-only")}>
							<Trans>Board</Trans>
						</span>
					</TabsTrigger>
				)}
				<TabsTrigger value="list" title={tabLabels ? undefined : t`List`}>
					<Icon name="rows" size={18} />
					<span className={cn(!tabLabels && "sr-only")}>
						<Trans>List</Trans>
					</span>
				</TabsTrigger>
				<TabsTrigger value="insights" title={tabLabels ? undefined : t`Insights`}>
					<Icon name="chart-line-up" size={18} />
					<span className={cn(!tabLabels && "sr-only")}>
						<Trans>Insights</Trans>
					</span>
				</TabsTrigger>
				{!phone && (
					<TabsTrigger value="calendar" title={tabLabels ? undefined : t`Calendar`}>
						<Icon name="calendar-dots" size={18} />
						<span className={cn(!tabLabels && "sr-only")}>
							<Trans>Calendar</Trans>
						</span>
					</TabsTrigger>
				)}
			</TabsList>
		</Tabs>
	);

	return (
		<div
			{...(fill ? { [FILL_SCREEN_ATTRIBUTE]: "" } : {})}
			className={cn(PAGE_CLASS, fill ? "flex min-h-0 flex-1 basis-0 flex-col gap-5 pb-6" : "grid content-start gap-5")}
		>
			{/* The title and, beside it, the views; the CSV menu and Save job on the other side. */}
			<header ref={rowRef} className="flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap">
				<div className="flex min-w-0 items-center gap-5">
					<h1 ref={titleRef} className="shrink-0 font-display text-[30px] leading-9 font-medium whitespace-nowrap">
						<Trans>Applications</Trans>
					</h1>
					{withViews && !phone && (
						<div className="flex min-w-0 items-center gap-3">
							<div ref={tabsRef} className="shrink-0">
								{viewTabs}
							</div>
							{showViewsButton && viewsMenu && <ViewsButton ref={viewsRef} phone={false} {...viewsMenu} />}
						</div>
					)}
				</div>
				<div ref={actionsRef} className="flex shrink-0 items-center gap-2">
					<DropdownMenu>
						<DropdownMenuTrigger
							render={<Button size="icon" variant="secondary" aria-label={t`Import or export CSV`} />}
						>
							<Icon name="dots-three" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => setImporting(true)}>
								<Trans>Import from CSV…</Trans>
							</DropdownMenuItem>
							<DropdownMenuItem disabled={empty || !applications} onClick={() => setExporting(true)}>
								<Trans>Export to CSV…</Trans>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button onClick={() => setAdding(true)}>
						<Icon name="plus" />
						<Trans>Save job</Trans>
					</Button>
				</div>
			</header>

			{applications && <FollowUpNudge applications={applications} onOpen={setSelectedId} />}

			{isError && (
				<div
					role="alert"
					className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4"
				>
					<p className="text-sm text-danger-text">
						<Trans>Couldn't load applications. Try again.</Trans>
					</p>
					<Button variant="secondary" disabled={isFetching} onClick={() => void refetch()}>
						<Trans>Retry</Trans>
					</Button>
				</div>
			)}

			{isError && !applications ? null : empty ? (
				<EmptyState onAdd={() => setAdding(true)} onImport={() => setImporting(true)} />
			) : (
				<>
					{/*
					  The toolbar takes the whole row: search, the filters, then Sort and Columns at the end. Under a 1280px window
					  it's two lines, search with Sort and Columns, then the filters. Insights doesn't follow the filters or the
					  sort, so it hides the toolbar. Phones keep the tabs on their own line above it.
					*/}
					{(phone || shown !== "insights") && (
						<div className="flex flex-wrap items-center gap-2">
							{phone && viewTabs}
							{phone && showViewsButton && viewsMenu && (
								<div className="ms-auto flex min-w-0">
									<ViewsButton phone {...viewsMenu} />
								</div>
							)}
							{shown !== "insights" && (
								<>
									{phone && <span className="basis-full" />}
									<div
										className={cn(
											"relative",
											phone ? "min-w-0 flex-1 basis-0" : "max-w-[400px] min-w-[220px] flex-[4_1_220px]",
										)}
									>
										<Icon
											name="magnifying-glass"
											size={18}
											className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3"
										/>
										<Input
											type="search"
											aria-label={t`Search applications`}
											placeholder={t`Search role, company or contact`}
											value={query}
											className="ps-8"
											onChange={(event) => setQuery(event.target.value)}
										/>
									</div>
									{phone ? (
										<PhoneFilters {...filterProps} trailing={<PhoneSortButton sort={sort} onChange={setSort} />} />
									) : (
										<>
											<FilterBar {...filterProps} className="max-xl:order-2 max-xl:basis-full xl:order-1" />
											{shown !== "calendar" && (
												<div className="ms-auto flex shrink-0 items-center gap-1.5 max-xl:order-1 xl:order-2">
													<SortButton sort={sort} onChange={setSort} />
													{shown === "list" && (
														<ColumnsButton
															columns={inView ? columnIds.map((id) => ({ id })) : accountColumns}
															onChange={setColumns}
															onReset={resetColumns}
														/>
													)}
												</div>
											)}
										</>
									)}
								</>
							)}
						</div>
					)}

					{isPending ? (
						<ViewSkeleton view={shown} />
					) : noMatches && shown !== "insights" ? (
						<div className="grid justify-items-center gap-2 py-16 text-center">
							<p className="text-sm font-medium">
								<Trans>No applications match these filters.</Trans>
							</p>
							<Button size="sm" variant="secondary" onClick={() => setFilters(clearAll())}>
								<Trans>Clear filters</Trans>
							</Button>
						</div>
					) : (
						<div
							key={shown}
							className={cn(
								shown === "board" && "flex min-h-96 flex-1 flex-col",
								viewSwitched
									? "transition-[opacity,translate] duration-standard ease-enter starting:translate-y-1 starting:opacity-0"
									: // The list fades in on its first appearance, after its skeleton.
										shown === "list" && "transition-opacity duration-standard ease-enter starting:opacity-0",
							)}
						>
							{shown === "list" && (
								<ApplicationList
									applications={visible}
									stages={filters.stage}
									stale={stale}
									sort={sort}
									onSortChange={setSort}
									columns={inView ? resolveColumnsWithWidths(layout, columnIds) : resolveListColumns(layout)}
									onColumnResize={resizeColumn}
									selectedId={selectedId}
									onOpen={(application) => setSelectedId(application.id)}
								/>
							)}
							{shown === "board" && (
								<ApplicationBoard
									applications={visible}
									stages={filters.stage}
									stale={stale}
									sort={sort}
									columnWidth={layout.boardColumnWidth}
									onColumnWidthChange={(width) => updateLayout({ boardColumnWidth: width })}
									onOpen={(application) => setSelectedId(application.id)}
								/>
							)}
							{shown === "insights" && <ApplicationInsights applications={applications ?? []} />}
							{shown === "calendar" && (
								<ApplicationCalendar
									applications={matching}
									allApplications={applications ?? []}
									onOpen={(application) => setSelectedId(application.id)}
								/>
							)}
						</div>
					)}
				</>
			)}

			<SaveViewDialog
				open={savingView}
				onOpenChange={setSavingView}
				filters={filters}
				sort={sort}
				columns={columnIds}
				noReplyDays={noReplyDays}
				onSave={saveNewView}
				existingName={(name) =>
					views?.find((view) => view.name.toLocaleLowerCase() === name.toLocaleLowerCase())?.name ?? name
				}
			/>
			<ManageViewsSheet
				open={managingViews}
				onOpenChange={setManagingViews}
				phone={phone}
				views={views ?? []}
				countOf={countOf}
				onReorder={(ids) => void savedViews.reorder({ ids }).catch(failed)}
				onRename={renameView}
				onToggleDefault={(view) => void savedViews.update({ id: view.id, isDefault: !view.isDefault }).catch(failed)}
				onDelete={(view) => void deleteView(view)}
			/>
			<AddApplicationDialog open={adding} onOpenChange={setAdding} onAdded={setSelectedId} />
			<ApplicationFormSheet
				open={Boolean(editing)}
				application={editing}
				onOpenChange={(open) => !open && setEditing(null)}
			/>
			<ImportApplicationsSheet open={importing} onOpenChange={setImporting} />
			<ExportApplicationsSheet
				open={exporting}
				onOpenChange={setExporting}
				applications={applications ?? []}
				filtered={matching}
			/>
			<ApplicationDetailSheet
				application={selected}
				onOpenChange={(open) => !open && setSelectedId(null)}
				onEditDetails={(application) => {
					setSelectedId(null);
					setEditing(application);
				}}
			/>
		</div>
	);
}

const NUDGE_STORAGE_KEY = "applications-follow-up-dismissed";

function readDismissed(): string[] {
	try {
		return JSON.parse(window.localStorage.getItem(NUDGE_STORAGE_KEY) ?? "[]") as string[];
	} catch {
		return [];
	}
}

/**
 * The follow-up nudge: the application waiting longest without a reply (by default 10+ days since applying; set or
 * turned off in Settings → Preferences). Dismissing it is remembered on this device; it doesn't come back for that
 * application.
 */
function FollowUpNudge({ applications, onOpen }: { applications: Application[]; onOpen: (id: string) => void }) {
	const [dismissed, setDismissed] = useState(readDismissed);
	const noReplyDays = useNoReplyDays();

	const dismissedIds = new Set(dismissed);
	const waiting = applications
		.filter((application) => !dismissedIds.has(application.id))
		.flatMap((application) => {
			const step = getNextStep(application, { noReplyDays });
			return step.kind === "no-reply" ? [{ application, days: step.days }] : [];
		})
		.sort((a, b) => b.days - a.days)[0];
	if (!waiting) return null;

	const dismiss = () => {
		const next = [...dismissed, waiting.application.id].slice(-200);
		setDismissed(next);
		try {
			window.localStorage.setItem(NUDGE_STORAGE_KEY, JSON.stringify(next));
		} catch {
			// Without storage the nudge is dismissed for this visit only.
		}
	};

	const { company } = waiting.application;
	const { days } = waiting;

	return (
		<div
			key={waiting.application.id}
			role="status"
			className={cn(
				ENTER_CLASS,
				"flex flex-wrap items-center gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn-text",
			)}
		>
			<Icon name="clock" size={20} />
			<span className="min-w-0 flex-1">
				<Trans>
					{company}: no reply for {days} days. A short follow-up is usually fine now.
				</Trans>
			</span>
			<Button size="sm" variant="secondary" onClick={() => onOpen(waiting.application.id)}>
				<Trans>Open</Trans>
			</Button>
			<Button size="icon-sm" variant="ghost" aria-label={t`Dismiss`} onClick={dismiss} className="text-warn-text">
				<Icon name="x" size={18} />
			</Button>
		</div>
	);
}

function EmptyState({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
	return (
		<div className="grid justify-items-center gap-3 py-20 text-center transition-[opacity,translate] duration-emphasized ease-enter starting:translate-y-2 starting:opacity-0">
			<span className="grid size-12 place-items-center rounded-xl bg-sunken text-ink-2">
				<Icon name="briefcase" size={26} />
			</span>
			<h2 className="text-lg font-semibold">
				<Trans>Track your first job</Trans>
			</h2>
			<p className="max-w-sm text-sm text-ink-2">
				<Trans>Paste a job link. We'll save the posting so Check, the assistant and your letter can use it.</Trans>
			</p>
			<div className="flex gap-2">
				<Button onClick={onAdd}>
					<Icon name="plus" />
					<Trans>Save job</Trans>
				</Button>
				<Button variant="secondary" onClick={onImport}>
					<Trans>Import from CSV</Trans>
				</Button>
			</div>
		</div>
	);
}

/** Each view's shape while applications load, so the first rows land where the placeholders were. */
function ViewSkeleton({ view }: { view: View }) {
	if (view === "insights") return <InsightsSkeleton />;
	if (view === "list")
		return (
			<div className="grid gap-2 pt-10">
				{Array.from({ length: 6 }, (_, index) => (
					<Skeleton key={index} className="h-[52px]" />
				))}
			</div>
		);
	if (view === "board") return <Skeleton className="min-h-96 flex-1 rounded-xl" />;
	return <Skeleton className="h-[calc(100svh-230px)] min-h-96 rounded-xl" />;
}
