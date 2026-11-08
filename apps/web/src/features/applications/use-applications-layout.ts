import type { ApplicationSort } from "@reactive-resume/schema/applications/filters";
import type { ApplicationsLayout, ListColumn, ListColumnId } from "@reactive-resume/schema/applications/layout";
import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { DEFAULT_LIST_COLUMNS, readApplicationsLayout } from "@reactive-resume/schema/applications/layout";
import { toast } from "@reactive-resume/ui/components/toast";
import { authClient } from "@/libs/auth/client";
import { sessionQueryKey } from "@/libs/root-context";

/** A change to the layout; null takes that part back to its default. */
export type LayoutChange = {
	sort?: ApplicationSort;
	listColumns?: ListColumn[] | null;
	boardColumnWidth?: number | null;
	/** Widths of columns the account's list doesn't show (set while a saved view showed them). */
	columnWidths?: ApplicationsLayout["columnWidths"] | null;
};

export function changeLayout(layout: ApplicationsLayout, change: LayoutChange): ApplicationsLayout {
	const { listColumns, boardColumnWidth, columnWidths, ...rest } = layout;
	const columns = change.listColumns === undefined ? listColumns : change.listColumns;
	const width = change.boardColumnWidth === undefined ? boardColumnWidth : change.boardColumnWidth;
	const widths = change.columnWidths === undefined ? columnWidths : change.columnWidths;
	return {
		...rest,
		...(change.sort ? { sort: change.sort } : {}),
		...(columns ? { listColumns: columns } : {}),
		...(width === undefined || width === null ? {} : { boardColumnWidth: width }),
		...(widths && Object.keys(widths).length > 0 ? { columnWidths: widths } : {}),
	};
}

/**
 * The change that sets one column's width on the account, whatever list is on screen: in the account's own list when
 * it shows the column, otherwise kept beside it. null takes it back to its starting width.
 */
export function resizeColumnChange(layout: ApplicationsLayout, id: ListColumnId, width: number | null): LayoutChange {
	const { [id]: _old, ...otherWidths } = layout.columnWidths ?? {};
	const columnWidths = width === null ? otherWidths : { ...otherWidths, [id]: width };
	const own: ListColumn[] = layout.listColumns ?? DEFAULT_LIST_COLUMNS.map((column) => ({ id: column }));
	if (!own.some((column) => column.id === id)) return { columnWidths };
	return {
		listColumns: own.map((column) => (column.id !== id ? column : width === null ? { id } : { id, width })),
		// A width set in the list wins; drop any kept one so it can't come back later.
		columnWidths: otherWidths,
	};
}

/** Saves wait this long after the last change, so a run of clicks or arrow keys is one request. */
const SAVE_DELAY = 400;

/**
 * The account's Applications layout (List columns, Board column width, sort). Changes show at once and are saved to
 * the account shortly after, then the session in the query cache follows, so the next page load starts from them. A
 * save that fails goes back to what was saved, with a toast. A change still waiting is saved when the page closes.
 */
export function useApplicationsLayout() {
	const { session } = useRouteContext({ strict: false });
	const queryClient = useQueryClient();
	const saved = readApplicationsLayout(session?.user.applicationsLayout);
	const [local, setLocal] = useState<ApplicationsLayout | null>(null);
	const layout = local ?? saved;

	const pending = useRef<ApplicationsLayout | null>(null);
	const timer = useRef<number | undefined>(undefined);

	const persist = async (next: ApplicationsLayout) => {
		const { error } = await authClient.updateUser({ applicationsLayout: next });
		if (error) {
			setLocal(null);
			toast.add({ type: "error", description: t`Couldn't save the layout, so it's back to how it was.` });
			return;
		}
		queryClient.setQueryData(sessionQueryKey, (current: typeof session | undefined) =>
			current ? { ...current, user: { ...current.user, applicationsLayout: next } } : current,
		);
	};

	const flush = () => {
		window.clearTimeout(timer.current);
		const next = pending.current;
		pending.current = null;
		if (next) void persist(next);
	};

	const flushOnLeave = useEffectEvent(flush);
	useEffect(() => () => flushOnLeave(), []);

	const update = (change: LayoutChange) => {
		const next = changeLayout(layout, change);
		setLocal(next);
		pending.current = next;
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(flush, SAVE_DELAY);
	};

	return { layout, update };
}
