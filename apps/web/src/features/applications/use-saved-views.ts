import type { ApplicationView } from "@reactive-resume/schema/applications/views";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/libs/orpc/client";

/** A taken name (ignoring case) comes back as a conflict. */
export const isNameTaken = (error: unknown) => error instanceof ORPCError && error.code === "CONFLICT";

/**
 * The account's saved views, in menu order, and the calls that change them. Every change reloads the list. While the
 * list can't load, there are none, so the page still opens.
 */
export function useSavedViews() {
	const queryClient = useQueryClient();
	const listKey = orpc.applications.views.list.queryKey({});
	const { data, isError } = useQuery(orpc.applications.views.list.queryOptions({}));
	const settled = { onSettled: () => queryClient.invalidateQueries({ queryKey: orpc.applications.views.key() }) };

	// The list follows each change at once, so a new view is on before the list reloads.
	const setList = (change: (views: ApplicationView[]) => ApplicationView[]) =>
		queryClient.setQueryData<ApplicationView[]>(listKey, (current) => (current ? change(current) : current));
	const create = useMutation(
		orpc.applications.views.create.mutationOptions({
			...settled,
			onSuccess: (created) =>
				setList((views) => [
					...views.map((view) => (created.isDefault ? { ...view, isDefault: false } : view)),
					created,
				]),
		}),
	);
	const update = useMutation(
		orpc.applications.views.update.mutationOptions({
			...settled,
			onSuccess: (updated) =>
				setList((views) =>
					views.map((view) =>
						view.id === updated.id ? updated : updated.isDefault ? { ...view, isDefault: false } : view,
					),
				),
		}),
	);
	const remove = useMutation(
		orpc.applications.views.delete.mutationOptions({
			...settled,
			onSuccess: (deleted) => setList((views) => views.filter((view) => view.id !== deleted.id)),
		}),
	);
	const reorder = useMutation(
		orpc.applications.views.reorder.mutationOptions({
			...settled,
			// The rows stay where they were dropped while the order saves.
			onMutate: async ({ ids }) => {
				await queryClient.cancelQueries({ queryKey: listKey });
				setList((current) =>
					ids.flatMap((id, position) => {
						const found = current.find((view) => view.id === id);
						return found ? [{ ...found, position }] : [];
					}),
				);
			},
		}),
	);

	return {
		views: data ?? (isError ? [] : undefined),
		/** The list as it is now, for Undo after other changes. */
		current: () => queryClient.getQueryData<ApplicationView[]>(listKey) ?? [],
		create: create.mutateAsync,
		update: update.mutateAsync,
		remove: remove.mutateAsync,
		reorder: reorder.mutateAsync,
	};
}
