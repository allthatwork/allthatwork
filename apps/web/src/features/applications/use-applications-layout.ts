import type { ApplicationSort } from "@reactive-resume/schema/applications/filters";
import type { ApplicationsLayout, ListColumn } from "@reactive-resume/schema/applications/layout";
import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { readApplicationsLayout } from "@reactive-resume/schema/applications/layout";
import { toast } from "@reactive-resume/ui/components/toast";
import { authClient } from "@/libs/auth/client";
import { sessionQueryKey } from "@/libs/root-context";

/** A change to the layout; null takes that part back to its default. */
export type LayoutChange = {
	sort?: ApplicationSort;
	listColumns?: ListColumn[] | null;
	boardColumnWidth?: number | null;
};

export function changeLayout(layout: ApplicationsLayout, change: LayoutChange): ApplicationsLayout {
	const { listColumns, boardColumnWidth, ...rest } = layout;
	const columns = change.listColumns === undefined ? listColumns : change.listColumns;
	const width = change.boardColumnWidth === undefined ? boardColumnWidth : change.boardColumnWidth;
	return {
		...rest,
		...(change.sort ? { sort: change.sort } : {}),
		...(columns ? { listColumns: columns } : {}),
		...(width === undefined || width === null ? {} : { boardColumnWidth: width }),
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
