import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { toast } from "@reactive-resume/ui/components/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { cn } from "@reactive-resume/utils/style";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";
import { refreshData } from "@/libs/query/client";

type Company = RouterOutput["directory"]["companies"][number];
type JobsState = Pick<Company, "jobs" | "careersUrl">;

/**
 * What a company's Watch box shows: watched, a page found from a posting link (can be watched), a saved link on a site
 * we can't watch, or nothing known.
 */
export type WatchState = "watched" | "found" | "saved" | "none";
export function watchState({ jobs, careersUrl }: JobsState): WatchState {
	if (jobs.watching.length) return "watched";
	if (jobs.found) return "found";
	return careersUrl ? "saved" : "none";
}

/**
 * Where Jobs ↗ goes and the open count beside it, first match wins: the watched page (the first, for old data with
 * more), the page found from a posting link, then a saved link, which has no count. Null when no page is known.
 */
export function jobsLink({ jobs, careersUrl }: JobsState): { url: string; count: number | null } | null {
	const [watched] = jobs.watching;
	if (watched) return { url: watched.url, count: watched.jobCount };
	if (jobs.found) return { url: jobs.found.url, count: jobs.found.jobCount };
	return careersUrl ? { url: careersUrl, count: null } : null;
}

/** Why the box is greyed out, shown on hover. */
export const watchDisabledReason = (state: WatchState) =>
	state === "saved"
		? t`Only Greenhouse, Ashby and Lever can be watched for now.`
		: t`No jobs page known yet. Open the company to look one up.`;

const failed = (error: unknown, fallback: string) =>
	toast.add({ type: "error", description: getOrpcErrorMessage(error, { fallback, allowServerMessage: true }) });

type JobsButtonProps = { url: string; className?: string | undefined };
/** Opens the company's jobs page in a new tab. Reads the same for every company. Sits above the row's link. */
export function JobsButton({ url, className }: JobsButtonProps) {
	return (
		<Button
			variant="secondary"
			size="sm"
			nativeButton={false}
			className={cn("relative z-1 h-6 px-2 text-xs", className)}
			render={<a href={url} target="_blank" rel="noopener noreferrer" />}
		>
			{t`Jobs`} ↗
		</Button>
	);
}

type DisabledWatchBoxProps = { reason: string; label: string };
/** A greyed-out box with its reason on hover, for the list and the company page. */
export function DisabledWatchBox({ reason, label }: DisabledWatchBoxProps) {
	return (
		<Tooltip>
			{/* A disabled control gets no hover, so the wrapper carries the tooltip. */}
			<TooltipTrigger render={<span className="relative z-1 inline-flex" />}>
				<Checkbox disabled aria-label={label} className="border-dashed bg-transparent" />
			</TooltipTrigger>
			<TooltipContent>{reason}</TooltipContent>
		</Tooltip>
	);
}

type WatchBoxProps = { company: Company };

/**
 * The Companies list's Watch box, the only place the list says watched or not. Ticking watches the page found from a
 * posting link; unticking stops every watched page. Both show at once, with Undo, and roll back with an error if the
 * change fails. The data is refreshed once the change (or its undo) is done, so the box doesn't flicker in between.
 */
export function WatchBox({ company }: WatchBoxProps) {
	const queryClient = useQueryClient();
	const state = watchState(company);
	const name = company.name;
	const label = t`Watch ${name}`;
	if (state === "saved" || state === "none")
		return <DisabledWatchBox reason={watchDisabledReason(state)} label={label} />;

	const key = orpc.directory.companies.queryKey({ input: {} });
	/** Shows a row state at once. A refetch in flight is cancelled first, so its answer can't overwrite this. */
	const show = async (row: JobsState) => {
		await queryClient.cancelQueries({ queryKey: key });
		queryClient.setQueryData(key, (rows) => rows?.map((item) => (item.id === company.id ? { ...item, ...row } : item)));
	};
	const before: JobsState = { jobs: company.jobs, careersUrl: company.careersUrl };

	const start = () => {
		const found = company.jobs.found;
		if (!found) return;
		void show({
			careersUrl: null,
			jobs: { found: null, watching: [{ ...found, id: "", source: "posting" }] },
		});
		const ref = { companyId: company.id, ats: found.ats, region: found.region, slug: found.slug };
		let undone = false;
		const started = client.boards.watch({ ...ref, source: "posting" });
		started.then(
			() => {
				if (!undone) void refreshData(queryClient);
			},
			(error: unknown) => {
				if (!undone) void show(before);
				failed(error, t`Couldn't watch this company's jobs.`);
				void refreshData(queryClient);
			},
		);
		const id = toast.add({
			title: t`Watching ${name}`,
			description: t`Its new roles show up in Career → Today.`,
			actionProps: {
				children: t`Undo`,
				onClick: () => {
					if (undone) return;
					undone = true;
					toast.close(id);
					void show(before);
					started.then(
						(watch) =>
							client.boards
								.unwatch({ id: watch.id })
								.catch((error: unknown) => failed(error, t`Couldn't stop watching.`))
								.finally(() => void refreshData(queryClient)),
						// The failed watch already said so.
						() => undefined,
					);
				},
			},
		});
	};

	const stop = () => {
		const pages = company.jobs.watching;
		const [first] = pages;
		// A page found from a posting link can be ticked again right away; the refresh settles the rest.
		const found =
			company.jobs.found ??
			(first?.source === "posting"
				? { ats: first.ats, region: first.region, slug: first.slug, url: first.url, jobCount: first.jobCount }
				: null);
		void show({ careersUrl: company.careersUrl, jobs: { watching: [], found } });
		let undone = false;
		const stopped = Promise.all(pages.map((page) => client.boards.unwatch({ id: page.id })));
		stopped.then(
			() => {
				if (!undone) void refreshData(queryClient);
			},
			(error: unknown) => {
				if (!undone) void show(before);
				failed(error, t`Couldn't stop watching.`);
				void refreshData(queryClient);
			},
		);
		const id = toast.add({
			title: t`Stopped watching ${name}`,
			actionProps: {
				children: t`Undo`,
				onClick: () => {
					if (undone) return;
					undone = true;
					toast.close(id);
					// Watched again under new ids: pending (no id) until the refresh brings them.
					void show({ ...before, jobs: { ...before.jobs, watching: pages.map((page) => ({ ...page, id: "" })) } });
					stopped.then(
						() =>
							Promise.all(
								pages.map((page) =>
									client.boards.watch({
										companyId: company.id,
										ats: page.ats,
										region: page.region,
										slug: page.slug,
										source: page.source,
									}),
								),
							)
								.catch((error: unknown) => failed(error, t`Couldn't watch this company's jobs.`))
								.finally(() => void refreshData(queryClient)),
						() => undefined,
					);
				},
			},
		});
	};

	// A watch just started has no id until the refresh; it can't be stopped before then.
	const pending = company.jobs.watching.some((page) => !page.id);
	return (
		<span className="relative z-1 inline-flex">
			<Checkbox
				aria-label={label}
				aria-busy={pending || undefined}
				disabled={pending}
				checked={state === "watched"}
				onCheckedChange={(checked) => (checked ? start() : stop())}
			/>
		</span>
	);
}
