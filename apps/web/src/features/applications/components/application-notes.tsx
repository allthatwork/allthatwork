import type { Application } from "../types";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { useInvalidateApplications } from "../use-application-actions";
import { DraftRecovery } from "@/features/career/draft-recovery";
import { useDebouncedSave, useSessionDraft } from "@/features/career/hooks";
import { getAccountGeneration } from "@/libs/auth/clear-account-data";
import { orpc } from "@/libs/orpc/client";

type NotesField = "notes" | "searchNotes";

type ApplicationNotesProps = {
	application: Pick<Application, "id"> & Partial<Pick<Application, NotesField>>;
	/** Which text this edits: the user's own notes (the default) or the job search's assessment. */
	field?: NotesField;
	label?: string;
	placeholder?: string;
	rows?: number;
	/** Draws the field's label, given its text and the field's id. A small label when not given. */
	renderLabel?: (label: ReactNode, htmlFor: string) => ReactNode;
};

// Pending saves are kept per application and per field.
const saves = new Map<string, Promise<void>>();

export function ApplicationNotes({
	application,
	field = "notes",
	label,
	placeholder,
	rows = 3,
	renderLabel,
}: ApplicationNotesProps) {
	const id = useId();
	const generation = useRef(getAccountGeneration());
	const invalidate = useInvalidateApplications();
	const queryClient = useQueryClient();
	const draft = useSessionDraft(
		`${field}:${application.id}`,
		application[field] ?? "",
		(value) => (typeof value === "string" ? value : undefined),
		true,
	);
	const [saved, setSaved] = useState(application[field] ?? "");
	const latest = useRef(draft);
	useLayoutEffect(() => {
		latest.current = draft;
	});
	const { mutateAsync, isError } = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => invalidate(application.id),
		onError: () => toast.add({ type: "error", description: t`Couldn't save the notes. Try again.` }),
	});
	const save = (value: string) => {
		const key = draft.key;
		if (key === null) return;
		const pending = (saves.get(key) ?? Promise.resolve())
			.then(async () => {
				if (generation.current !== getAccountGeneration()) return;
				const next = value.trim() ? value : null;
				await mutateAsync(
					field === "notes" ? { id: application.id, notes: next } : { id: application.id, searchNotes: next },
				);
				if (generation.current !== getAccountGeneration()) return;
				queryClient.setQueryData<Application>(
					orpc.applications.getById.queryKey({ input: { id: application.id } }),
					(current) => (current ? { ...current, [field]: next } : current),
				);
				setSaved(value);
				latest.current.clear(value);
			})
			.catch(() => {})
			.finally(() => {
				if (saves.get(key) === pending) saves.delete(key);
			});
		saves.set(key, pending);
	};
	const flush = useDebouncedSave(draft.restored ? saved : draft.value, saved, save, 800);
	return (
		<section className={renderLabel ? "grid" : "grid gap-2"}>
			<DraftRecovery {...draft} />
			{renderLabel ? (
				renderLabel(label ?? <Trans>Notes</Trans>, id)
			) : (
				<label htmlFor={id} className="text-xs font-semibold text-ink-3">
					{label ?? <Trans>Notes</Trans>}
				</label>
			)}
			<Textarea
				id={id}
				rows={rows}
				className={renderLabel ? "min-h-0 resize-none px-3 py-2 text-[13px]/[19px]" : undefined}
				value={draft.value}
				placeholder={placeholder ?? t`Anything to remember about this job`}
				onBlur={flush}
				onChange={(event) => draft.setValue(event.target.value)}
			/>
			{isError && (
				<button type="button" onClick={() => flush(true)} className="justify-self-start text-sm underline">
					<Trans>Retry save</Trans>
				</button>
			)}
		</section>
	);
}
