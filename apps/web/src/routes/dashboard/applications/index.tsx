import type { FiltersChange, ShownSnapshot } from "@/features/applications/filter";
import type { Application, ApplicationSummary } from "@/features/applications/types";
import type { ApplicationFilters, ApplicationSort } from "@reactive-resume/schema/applications/filters";
import type { ListColumn, ListColumnId } from "@reactive-resume/schema/applications/layout";
import type { ApplicationView } from "@reactive-resume/schema/applications/views";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { HotkeysProvider, useHotkey } from "@tanstack/react-hotkeys";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useRef, useState } from "react";
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
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { EmptyState } from "@reactive-resume/ui/components/empty-state";
import { Icon } from "@reactive-resume/ui/components/icon";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { FilterField } from "@/components/calm/filter-bar";
import { Page } from "@/components/calm/page";
import { FILL_SCREEN_ATTRIBUTE } from "@/components/layout/page";
import { PhoneHeaderActions } from "@/components/layout/phone-header-actions";
import { takePostingCapture } from "@/features/applications/capture";
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
import { clearAll, matchesFilters, mergeSnapshot, sameFilters, withHeld } from "@/features/applications/filter";
import {
	filterSearchShape,
	filtersFromSearch,
	searchFromFilters,
	sortFromSearch,
} from "@/features/applications/filter-search";
import { getNextStep, needsFollowUp, useNoReplyDays } from "@/features/applications/next-step";
import {
	applicationDetailQueryOptions,
	applicationsFullListQueryOptions,
	applicationsListQueryOptions,
	hydrateApplicationDetail,
} from "@/features/applications/queries";
import { filtersOfView, isViewEdited, viewFiltersOf } from "@/features/applications/saved-views";
import { applicationLanesQueryOptions, useApplicationLanes } from "@/features/applications/use-application-lanes";
import { resizeColumnChange, useApplicationsLayout } from "@/features/applications/use-applications-layout";
import { useRememberedFilters } from "@/features/applications/use-remembered-filters";
import { isNameTaken, useSavedViews } from "@/features/applications/use-saved-views";
import { useTabLabels } from "@/features/applications/use-tab-labels";
import { useToolbarLines } from "@/features/applications/use-toolbar-lines";
import { useCareerTime, useNow } from "@/features/career/shared";
import { useShortcutSettings } from "@/features/keyboard-shortcuts/settings";
import { useShortcutsPage } from "@/features/keyboard-shortcuts/store";
import { toastError } from "@/libs/error-message";
import { ENTER_CLASS } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";
import { getPageTitle } from "@/libs/seo";

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

// How long the page waits for the list and lanes before drawing anyway (a skeleton, or rows in the default order).
const LOADER_WAIT_MS = 1000;

export const Route = createFileRoute("/dashboard/applications/")({
	head: () => ({ meta: [{ title: getPageTitle(t`Applications`) }] }),
	component: RouteComponent,
	validateSearch: searchSchema,
	search: { middlewares: [stripSearchParams(defaultSearch)] },
	// Arrive with the list, as Documents does: a new account sees "Follow each job from saved to offer" at once, not a toolbar and a
	// skeleton that then vanish. The lanes come with it when they're quick, so rows first draw in the owner's lane order;
	// slow or failing requests never hold the page (it shows the defaults and the lanes' own error). A failed list still
	// renders the page, which shows its error and retry.
	// The two requests can share one batch, so one bound covers both.
	loader: async ({ context }) => {
		await Promise.race([
			Promise.allSettled([
				context.queryClient.ensureQueryData(applicationsListQueryOptions()),
				context.queryClient.ensureQueryData(applicationLanesQueryOptions()),
			]),
			new Promise((resolve) => setTimeout(resolve, LOADER_WAIT_MS)),
		]);
	},
});

const NO_SNAPSHOT: ShownSnapshot = new Map();

const NO_VIEW = { viewId: null, viewColumns: null };

function RouteComponent() {
	useShortcutsPage(t`Applications`);
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
	const overlayScope = `applications-overlay-${useId()}`;
	const pageRef = useRef<HTMLDivElement>(null);
	const collectionRef = useRef<HTMLDivElement>(null);
	const openingControl = useRef<HTMLElement | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	// A posting shared from the browser opens Add with it.
	const [capture, setCapture] = useState(takePostingCapture);
	const [adding, setAdding] = useState(!!capture);
	const [importing, setImporting] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [exportLoading, setExportLoading] = useState(false);
	const lanes = useApplicationLanes();
	const [editing, setEditing] = useState<Application | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	// Views animate in only after a switch, never on the page's first render.
	const [viewSwitched, setViewSwitched] = useState(false);
	const [savingView, setSavingView] = useState(false);
	const [managingViews, setManagingViews] = useState(false);

	const { data: applications, isPending, isError, isFetching, refetch } = useQuery(applicationsListQueryOptions());
	const { data: profile } = useQuery(orpc.career.profile.queryOptions());
	const noReplyDays = useNoReplyDays();
	const { timeZone } = useCareerTime();
	const [now] = useState(() => new Date());
	const context = { now, noReplyDays, timeZone };
	const characterShortcuts = useShortcutSettings((state) => state.characterShortcuts);
	useHotkey(
		"/",
		(event) => {
			if (event.keyCode === 229) return;
			searchRef.current?.focus();
		},
		{
			enabled: characterShortcuts && Boolean(applications?.length),
			target: pageRef,
			meta: { name: t`Filter applications` },
		},
	);

	const setSearch = (patch: Partial<Search>, replace = false) =>
		void navigate({ replace, resetScroll: false, search: (prev: Search) => ({ ...prev, ...patch }) });
	// Typing a number in Fit or Dates replaces the address after its first keystroke, so Back skips the digits.
	const setFilters: FiltersChange = (next, options) => {
		if (next.q !== query) setQuery(next.q);
		setSearch(searchFromFilters(next, sort), options?.replace ?? false);
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

	// Old links' ?closed=true, and upstream's ?followUp and ?needsYou: the filters already include them; write them out
	// and drop the old params.
	const legacyClosed = search.closed !== undefined || search.followUp !== undefined || search.needsYou !== undefined;
	useEffect(() => {
		if (!legacyClosed) return;
		void navigate({
			replace: true,
			resetScroll: false,
			search: (prev: Search) => {
				const { filters: mapped, sort: sorted } = filtersFromSearch(prev);
				return {
					...prev,
					...searchFromFilters(mapped, sorted),
					closed: undefined,
					followUp: undefined,
					needsYou: undefined,
				};
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

	const queryClient = useQueryClient();
	const { data: fullApplications } = useQuery({ ...applicationsFullListQueryOptions(), enabled: exporting });

	const PREFETCH_LIMIT = 12;
	const prefetchInFlight = useRef(new Set<string>());
	const prefetch = useCallback(
		(id: string) => {
			const options = applicationDetailQueryOptions(id);
			if (
				prefetchInFlight.current.has(id) ||
				prefetchInFlight.current.size >= PREFETCH_LIMIT ||
				queryClient.getQueryData(options.queryKey) ||
				queryClient.getQueryState(options.queryKey)?.fetchStatus === "fetching"
			)
				return;
			prefetchInFlight.current.add(id);
			void queryClient
				.fetchQuery(options)
				.catch(() => {})
				.finally(() => prefetchInFlight.current.delete(id));
		},
		[queryClient],
	);

	useEffect(() => {
		if (!applications) return;
		for (const application of applications) hydrateApplicationDetail(queryClient, application);
	}, [applications, queryClient]);

	useEffect(() => {
		let timer: number | undefined;
		const openControl = (target: EventTarget | null) =>
			target instanceof Element ? target.closest<HTMLElement>("[data-application-open]") : null;
		const onPointerOver = (event: PointerEvent) => {
			const open = openControl(event.target);
			if (!open || open.contains(event.relatedTarget as Node | null)) return;
			const id = open.closest<HTMLElement>("[data-application-id]")?.dataset.applicationId;
			if (!id) return;
			window.clearTimeout(timer);
			timer = window.setTimeout(() => prefetch(id), 120);
		};
		const onPointerOut = (event: PointerEvent) => {
			const open = openControl(event.target);
			if (open && !open.contains(event.relatedTarget as Node | null)) window.clearTimeout(timer);
		};
		const onFocusIn = (event: FocusEvent) => {
			const id = openControl(event.target)?.closest<HTMLElement>("[data-application-id]")?.dataset.applicationId;
			if (id) {
				window.clearTimeout(timer);
				prefetch(id);
			}
		};
		document.addEventListener("pointerover", onPointerOver);
		document.addEventListener("pointerout", onPointerOut);
		document.addEventListener("focusin", onFocusIn);
		return () => {
			document.removeEventListener("pointerover", onPointerOver);
			document.removeEventListener("pointerout", onPointerOut);
			document.removeEventListener("focusin", onFocusIn);
			window.clearTimeout(timer);
		};
	}, [prefetch]);
	// A tag chip adds its tag to the Tags filter.
	const filterByTag = useCallback(
		(tag: string) =>
			void navigate({
				resetScroll: false,
				search: (prev: Search) => {
					const { filters: current } = filtersFromSearch(prev);
					return current.tag.includes(tag) ? prev : { ...prev, tag: [...current.tag, tag] };
				},
			}),
		[navigate],
	);

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
	const isMatch = (application: ApplicationSummary) => matchesFilters(application, filters, context);
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
	const shown: View = phone && view === "board" ? "list" : view;
	const empty = !!applications && applications.length === 0;
	// Hoisted so the compiler keeps one function; inline, it changes with every keystroke and re-renders each row.
	const openApplication = (application: ApplicationSummary) => {
		const focused = document.activeElement;
		if (!openingControl.current && focused instanceof HTMLElement && pageRef.current?.contains(focused))
			openingControl.current = focused;
		hydrateApplicationDetail(queryClient, application);
		setSelectedId(application.id);
	};
	// Export reads the full rows (posting, notes, timeline); the list only has summaries.
	const matchingIds = new Set(matching.map((application) => application.id));
	const matchingFullApplications = fullApplications?.filter((application) => matchingIds.has(application.id)) ?? [];
	const openExport = async () => {
		if (exportLoading) return;
		setExportLoading(true);
		try {
			await queryClient.fetchQuery({ ...applicationsFullListQueryOptions(), staleTime: 0 });
			setExporting(true);
		} catch (error) {
			toastError(error, t`Couldn't load this. Your saved data hasn't changed.`);
		} finally {
			setExportLoading(false);
		}
	};
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
	// The toolbar takes two lines when one can't hold it (measured).
	const { twoLines, toolbarRef, filtersRef, endRef } = useToolbarLines(
		withViews && !phone && shown !== "insights",
		shown,
	);

	const viewTabs = (
		<SegmentedControl
			aria-label={t`View`}
			value={shown}
			onValueChange={(value) => {
				setViewSwitched(true);
				setSearch({ view: value as View });
			}}
		>
			{!phone && (
				<SegmentedControlItem value="board" title={tabLabels ? undefined : t`Board`}>
					<Icon name="kanban" />
					<span className={cn(!tabLabels && "sr-only")}>
						<Trans>Board</Trans>
					</span>
				</SegmentedControlItem>
			)}
			<SegmentedControlItem value="list" title={tabLabels ? undefined : t`List`}>
				<Icon name="list" />
				<span className={cn(!tabLabels && "sr-only")}>
					<Trans>List</Trans>
				</span>
			</SegmentedControlItem>
			<SegmentedControlItem value="insights" title={tabLabels ? undefined : t`Insights`}>
				<Icon name="chart-line-up" />
				<span className={cn(!tabLabels && "sr-only")}>
					<Trans>Insights</Trans>
				</span>
			</SegmentedControlItem>
			<SegmentedControlItem value="calendar" title={tabLabels ? undefined : t`Calendar`}>
				<Icon name="calendar-blank" />
				<span className={cn(!tabLabels && "sr-only")}>
					<Trans>Calendar</Trans>
				</span>
			</SegmentedControlItem>
		</SegmentedControl>
	);

	const saveJobButton = (
		<Button
			variant="primary"
			onClick={() => setAdding(true)}
			aria-label={t`Save a job`}
			className="max-sm:size-11 max-sm:p-0"
		>
			<Icon name="plus" />
			<span className="max-sm:hidden">
				<Trans>Save a job</Trans>
			</span>
		</Button>
	);

	return (
		<Page
			ref={pageRef}
			onClickCapture={(event) => {
				const trigger =
					event.target instanceof Element ? event.target.closest<HTMLElement>("[data-application-open]") : null;
				if (trigger) openingControl.current = trigger;
			}}
			tabIndex={-1}
			{...(fill ? { [FILL_SCREEN_ATTRIBUTE]: "" } : {})}
			// Full width: Applications uses the whole content area, so it has no reading width (`PageBody`).
			className={cn("gap-5 outline-none", fill ? "basis-0 pb-6" : "pb-24")}
		>
			{/* The title and, beside it, the views; the CSV menu and Save job on the other side. */}
			<header ref={rowRef} className="flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap">
				<div className="flex min-w-0 items-center gap-5">
					<h1 ref={titleRef} className="shrink-0 t-root-title whitespace-nowrap">
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
					{/* One More menu beside the one accent action: icon-only buttons are for back, close and more. */}
					<DropdownMenu>
						<DropdownMenuTrigger render={<Button size="icon" variant="secondary" aria-label={t`More`} />}>
							<Icon name="dots-three" size={20} />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-[212px]">
							<HotkeysProvider scope={`${overlayScope}-more`} exclusive>
								<DropdownMenuItem onClick={() => setImporting(true)}>
									<Icon name="upload-simple" />
									<Trans>Import from CSV…</Trans>
								</DropdownMenuItem>
								<DropdownMenuItem disabled={empty || !applications || exportLoading} onClick={() => void openExport()}>
									<Icon name="download-simple" />
									<Trans>Export to CSV…</Trans>
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									onClick={() => void navigate({ to: "/dashboard/trash", search: { kind: "applications" } })}
								>
									<Icon name="trash" />
									<Trans>Trash</Trans>
								</DropdownMenuItem>
							</HotkeysProvider>
						</DropdownMenuContent>
					</DropdownMenu>
					{!phone && saveJobButton}
					<PhoneHeaderActions>{phone && saveJobButton}</PhoneHeaderActions>
				</div>
			</header>

			{applications && (
				<FollowUpNudge
					applications={applications}
					onOpen={setSelectedId}
					// Show: the attention filter's late replies and due follow-ups.
					onShowAll={() => setFilters({ ...clearAll(), attention: ["no-reply", "follow-up"] })}
				/>
			)}

			{isError && (
				<div role="alert" className="grid gap-3.5 rounded-xl border border-line p-5">
					<p className="flex items-start gap-2.5 text-sm/5 text-ink">
						<Icon name="warning-circle" size={20} className="shrink-0 text-warn-text" />
						<Trans>Couldn't load this. Your saved data hasn't changed.</Trans>
					</p>
					<Button
						variant="secondary"
						size="sm"
						className="justify-self-start"
						loading={isFetching}
						onClick={() => void refetch()}
					>
						{isFetching ? <Trans>Retrying…</Trans> : <Trans>Try again</Trans>}
					</Button>
				</div>
			)}

			{lanes.error && (
				<div role="alert" className="flex items-center gap-3 rounded-lg bg-warn-soft px-4 py-3.5 text-warn-text">
					<Icon name="warning-circle" size={20} className="shrink-0" />
					<p className="min-w-0 flex-1 text-sm/5">
						<Trans>Couldn't load your stages, so the standard ones are shown.</Trans>
					</p>
					<Button variant="secondary" size="sm" className="shrink-0" onClick={() => void lanes.refetch()}>
						<Trans>Try again</Trans>
					</Button>
				</div>
			)}

			{isError && !applications ? null : empty ? (
				<EmptyState
					title={<Trans>Follow each job from saved to offer</Trans>}
					description={
						<Trans>Paste a job link. The posting is kept, so Check, the assistant and your letter can use it.</Trans>
					}
					action={
						<Button onClick={() => setAdding(true)}>
							<Icon name="plus" />
							<Trans>Save a job</Trans>
						</Button>
					}
					secondary={
						<Button variant="secondary" onClick={() => setImporting(true)}>
							<Trans>Import from CSV</Trans>
						</Button>
					}
					className="transition-[opacity,translate] duration-emphasized ease-enter starting:translate-y-2 starting:opacity-0"
				/>
			) : (
				<>
					{/*
					  The toolbar takes the whole row: search, the filters, then Sort and Columns at the end. When one line can't
					  hold them (measured, at any width), it's two lines: search with Sort and Columns, then all the filters.
					  Insights doesn't follow the filters or the sort, so it hides the toolbar. Phones keep the tabs on their own
					  line above it.
					*/}
					{(phone || shown !== "insights") && (
						<div ref={toolbarRef} className="flex flex-wrap items-center gap-2">
							{phone && viewTabs}
							{phone && showViewsButton && viewsMenu && (
								<div className="ms-auto flex min-w-0">
									<ViewsButton phone {...viewsMenu} />
								</div>
							)}
							{shown !== "insights" && (
								<>
									{phone && <span className="basis-full" />}
									<FilterField
										ref={searchRef}
										label={t`Filter applications`}
										placeholder={t`Search role, company or contact`}
										{...(characterShortcuts && !phone ? { shortcut: "/" } : {})}
										value={query}
										onChange={(event) => setQuery(event.target.value)}
										className={cn(
											"w-auto",
											phone ? "min-w-0 flex-1 basis-0" : "max-w-[400px] min-w-[220px] flex-[4_1_220px]",
										)}
									/>
									{phone ? (
										<PhoneFilters {...filterProps} trailing={<PhoneSortButton sort={sort} onChange={setSort} />} />
									) : (
										<>
											<FilterBar
												{...filterProps}
												ref={filtersRef}
												className={twoLines ? "order-2 basis-full" : "order-1"}
											/>
											{shown !== "calendar" && (
												<div
													ref={endRef}
													className={cn("ms-auto flex shrink-0 items-center gap-1.5", twoLines ? "order-1" : "order-2")}
												>
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
						<EmptyState
							title={<Trans>No matching applications</Trans>}
							description={<Trans>Try different words or clear your filters.</Trans>}
							action={
								<Button variant="secondary" onClick={() => setFilters(clearAll())}>
									<Trans>Clear filters</Trans>
								</Button>
							}
						/>
					) : (
						<div
							key={shown}
							ref={collectionRef}
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
									onOpen={openApplication}
									onTagSelect={filterByTag}
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
									onOpen={openApplication}
									onTagSelect={filterByTag}
									onSaveJob={() => setAdding(true)}
								/>
							)}
							{shown === "insights" && (
								// Insights counts every application: it doesn't follow the filters.
								<ApplicationInsights applications={applications ?? []} />
							)}
							{shown === "calendar" && (
								<ApplicationCalendar
									compact={phone}
									applications={matching}
									allApplications={applications ?? []}
									onClearFilters={sameFilters(filters, clearAll()) ? undefined : () => setFilters(clearAll())}
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
			<HotkeysProvider
				scope={overlayScope}
				exclusive
				enabled={adding || importing || exporting || !!editing || !!selectedId}
			>
				<AddApplicationDialog
					open={adding}
					initialCapture={capture}
					onOpenChange={(open) => {
						setAdding(open);
						if (!open) setCapture(null);
					}}
					onAdded={setSelectedId}
				/>
				<ApplicationFormSheet
					open={Boolean(editing)}
					application={editing}
					onOpenChange={(open) => !open && setEditing(null)}
				/>
				<ImportApplicationsSheet open={importing} onOpenChange={setImporting} />
				<ExportApplicationsSheet
					open={exporting}
					onOpenChange={setExporting}
					applications={fullApplications ?? []}
					filtered={matchingFullApplications}
				/>
				<ApplicationDetailSheet
					returnFocus={(id) => {
						const trigger = openingControl.current;
						openingControl.current = null;
						if (editing || adding) return null;
						if (
							trigger?.isConnected &&
							trigger.getClientRects().length > 0 &&
							trigger.closest<HTMLElement>("[data-application-id]")?.dataset.applicationId === id
						)
							return trigger;
						const rows = Array.from(
							collectionRef.current?.querySelectorAll<HTMLElement>("[data-application-id] [data-application-open]") ??
								[],
						).filter((row) => row.getClientRects().length > 0);
						const row =
							rows.find((item) => item.closest<HTMLElement>("[data-application-id]")?.dataset.applicationId === id) ??
							rows[0];
						if (row) return row;
						const heading = pageRef.current?.querySelector<HTMLElement>("h1") ?? null;
						if (heading) heading.tabIndex = -1;
						return heading;
					}}
					application={selected}
					onOpenChange={(open) => !open && setSelectedId(null)}
					onEditDetails={(application) => {
						setSelectedId(null);
						setEditing(application);
					}}
				/>
			</HotkeysProvider>
		</Page>
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

type FollowUpNudgeProps = {
	applications: ApplicationSummary[];
	onOpen: (id: string) => void;
	onShowAll: () => void;
};

/**
 * The follow-up nudge: applications that owe a follow-up (a due follow-up date, or no reply after the account's
 * no-reply days: 10 by default, set or turned off in Settings → Preferences), from the same next-step rules Career →
 * Today reads. One is named; several are counted with Show to filter the list. Dismissing is remembered on this
 * device; dismissed applications don't come back here.
 */
function FollowUpNudge({ applications, onOpen, onShowAll }: FollowUpNudgeProps) {
	const { timeZone } = useCareerTime();
	const now = useNow();
	const [dismissed, setDismissed] = useState(readDismissed);
	const noReplyDays = useNoReplyDays();

	const dismissedIds = new Set(dismissed);
	const owed = applications
		.filter((application) => !dismissedIds.has(application.id))
		.flatMap((application) => {
			const step = getNextStep(application, now, timeZone, undefined, noReplyDays);
			return needsFollowUp(step, now) ? [{ application, step }] : [];
		})
		// The longest silence first; dated follow-ups after it.
		.sort((a, b) => (b.step.kind === "no-reply" ? b.step.days : -1) - (a.step.kind === "no-reply" ? a.step.days : -1));
	const first = owed[0];
	if (!first) return null;

	const dismiss = () => {
		const next = [...dismissed, ...owed.map(({ application }) => application.id)].slice(-1000);
		setDismissed(next);
		try {
			window.localStorage.setItem(NUDGE_STORAGE_KEY, JSON.stringify(next));
		} catch {
			// Without storage the nudge is dismissed for this visit only.
		}
	};

	const { company } = first.application;
	const count = owed.length;
	const days = first.step.kind === "no-reply" ? first.step.days : 0;

	return (
		<div
			key={owed.length === 1 ? first.application.id : "several"}
			data-application-id={owed.length === 1 ? first.application.id : undefined}
			role="status"
			className={cn(
				ENTER_CLASS,
				"flex flex-wrap items-center gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn-text",
			)}
		>
			<Icon name="clock" size={20} />
			<span className="min-w-0 flex-1">
				{owed.length > 1 ? (
					<Plural value={count} one="# application needs a follow-up." other="# applications need a follow-up." />
				) : first.step.kind === "no-reply" && first.step.after === "interview" ? (
					<Plural
						value={days}
						one={`${company}: no word since your interview # day ago. A short follow-up is usually fine now.`}
						other={`${company}: no word since your interview # days ago. A short follow-up is usually fine now.`}
					/>
				) : first.step.kind === "no-reply" ? (
					<Plural
						value={days}
						one={`${company}: no reply for # day. A short follow-up is usually fine now.`}
						other={`${company}: no reply for # days. A short follow-up is usually fine now.`}
					/>
				) : (
					<Trans>{company}: a follow-up is due.</Trans>
				)}
			</span>
			{owed.length > 1 ? (
				<Button size="sm" variant="secondary" onClick={onShowAll}>
					<Trans>Show</Trans>
				</Button>
			) : (
				<Button size="sm" variant="secondary" data-application-open onClick={() => onOpen(first.application.id)}>
					<Trans>Open</Trans>
				</Button>
			)}
			<Button size="icon-sm" variant="ghost" aria-label={t`Dismiss`} onClick={dismiss} className="text-warn-text">
				<Icon name="x" size={18} />
			</Button>
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
