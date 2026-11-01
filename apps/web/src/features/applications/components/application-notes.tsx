import type { Application } from "../types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useState } from "react";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { useInvalidateApplications } from "../use-application-actions";
import { orpc } from "@/libs/orpc/client";

type NotesField = "notes" | "searchNotes";

type ApplicationNotesProps = {
	application: Pick<Application, "id"> & Partial<Pick<Application, NotesField>>;
	/** Which text this edits: the user's own notes (the default) or the job search's assessment. */
	field?: NotesField;
	label?: string;
	placeholder?: string;
	rows?: number;
};

// Notes save a moment after typing stops.
const NOTES_SAVE_DELAY_MS = 800;
const drafts = new Map<string, string>();
const saves = new Map<string, Promise<void>>();

export function ApplicationNotes({
	application,
	field = "notes",
	label,
	placeholder,
	rows = 3,
}: ApplicationNotesProps) {
	const id = useId();
	// Drafts and pending saves are kept per application and per field.
	const key = `${field}:${application.id}`;
	const invalidate = useInvalidateApplications();
	const queryClient = useQueryClient();
	const [notes, setNotes] = useState(() => drafts.get(key) ?? application[field] ?? "");
	const { mutateAsync, isError } = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => invalidate(application.id),
		onError: () => toast.add({ type: "error", description: t`Couldn't save the notes.` }),
	});
	const save = useCallback(() => {
		const pending: Promise<void> = (saves.get(key) ?? Promise.resolve())
			.then(async () => {
				const value = drafts.get(key);
				if (value === undefined) return;
				const saved = value.trim() ? value : null;
				await mutateAsync(
					field === "notes" ? { id: application.id, notes: saved } : { id: application.id, searchNotes: saved },
				);
				queryClient.setQueryData<Application>(
					orpc.applications.getById.queryKey({ input: { id: application.id } }),
					(current) => (current ? { ...current, [field]: saved } : current),
				);
				if (drafts.get(key) === value) drafts.delete(key);
			})
			.catch(() => {}) // The mutation reports failure; retain the draft for retry.
			.finally(() => {
				if (saves.get(key) === pending) saves.delete(key);
			});
		saves.set(key, pending);
		return pending;
	}, [application.id, field, key, mutateAsync, queryClient]);

	useEffect(() => {
		if (!drafts.has(key)) return;
		const timeout = window.setTimeout(() => {
			void save();
		}, NOTES_SAVE_DELAY_MS);
		return () => window.clearTimeout(timeout);
	}, [notes, key, save]);

	// Closing the sheet mid-sentence still saves what was typed.
	useEffect(
		() => () => {
			void save();
		},
		[save],
	);

	return (
		<section className="grid gap-2">
			<label htmlFor={id} className="text-xs font-semibold text-ink-3 uppercase">
				{label ?? <Trans>Notes</Trans>}
			</label>
			<Textarea
				id={id}
				rows={rows}
				value={notes}
				placeholder={placeholder ?? t`Anything to remember about this job`}
				onChange={(event) => {
					drafts.set(key, event.target.value);
					setNotes(event.target.value);
				}}
			/>
			{isError && (
				<button
					type="button"
					onClick={() => {
						void save();
					}}
					className="justify-self-start text-sm underline"
				>
					<Trans>Retry save</Trans>
				</button>
			)}
		</section>
	);
}
