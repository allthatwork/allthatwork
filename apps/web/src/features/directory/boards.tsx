import type { RouterOutput } from "@/libs/orpc/client";
import type { BoardAts, BoardSource } from "@reactive-resume/schema/boards";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { BOARD_ATS_NAMES } from "@reactive-resume/schema/boards";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { useCareerTime } from "@/features/career/shared";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type Candidate = RouterOutput["boards"]["guess"][number];

const platform = (ats: BoardAts) => BOARD_ATS_NAMES[ats];
/** "2 hours ago", "yesterday", in a sentence. */
const lower = (value: string) => value.charAt(0).toLocaleLowerCase() + value.slice(1);

const failed = (error: unknown, fallback: string) =>
	toast.add({ type: "error", description: getOrpcErrorMessage(error, { fallback, allowServerMessage: true }) });

type CompanyBoardsProps = { companyId: string };

/**
 * A company's Open roles section: the jobs pages watched for it on Greenhouse, Ashby or Lever, one its posting links
 * point at (to confirm), a pasted careers link, and Find it for me, which tries name guesses. Every page found is shown
 * for confirming; only a confirmed one is watched and checked. Users never read the word "board".
 */
export function CompanyBoards({ companyId }: CompanyBoardsProps) {
	const id = useId();
	const { relative } = useCareerTime();
	const query = useQuery(orpc.boards.company.queryOptions({ input: { companyId } }));
	const schedules = useQuery(orpc.career.schedules.queryOptions({ input: {} }));
	const [link, setLink] = useState("");
	const [found, setFound] = useState<{ source: BoardSource; boards: Candidate[] } | null>(null);
	const fromLink = useMutation({
		...orpc.boards.fromLink.mutationOptions(),
		onSuccess: (boards) => setFound({ source: "link", boards }),
		onError: (error) => failed(error, t`Couldn't read that link.`),
	});
	const guess = useMutation({
		...orpc.boards.guess.mutationOptions(),
		onSuccess: (boards) => setFound({ source: "guess", boards }),
		onError: (error) => failed(error, t`Couldn't look for its jobs.`),
	});
	// Every mutation refetches all queries (MutationCache), so the lists follow.
	const watch = useMutation({
		...orpc.boards.watch.mutationOptions(),
		onSuccess: ({ added }) => {
			setFound(null);
			setLink("");
			toast.add({
				description:
					added === 1
						? t`Watching. 1 open role matched and is in New roles.`
						: added > 1
							? t`Watching. ${added} open roles matched and are in New roles.`
							: t`Watching. No open roles match your preferences right now.`,
			});
		},
		onError: (error) => failed(error, t`Couldn't watch this company's jobs.`),
	});
	const unwatch = useMutation({
		...orpc.boards.unwatch.mutationOptions(),
		onSuccess: () => toast.add({ description: t`Stopped watching` }),
		onError: (error) => failed(error, t`Couldn't stop watching.`),
	});

	const data = query.data;
	const hasSchedule = schedules.data?.some((row) => row.kind === "boards");
	const confirm = (board: { ats: BoardAts; region: "us" | "eu"; slug: string }, source: BoardSource) =>
		watch.mutate({ companyId, ats: board.ats, region: board.region, slug: board.slug, source });
	const confirming = (slug: string) => watch.isPending && watch.variables?.slug === slug;
	const boardKey = (board: { ats: string; region: string; slug: string }) =>
		`${board.ats}:${board.region}:${board.slug.toLowerCase()}`;
	const watchedKeys = new Set(data?.watched.map(boardKey));

	return (
		<section aria-labelledby={`${id}-boards`} className="grid gap-3">
			<div className="grid gap-1">
				<h3 id={`${id}-boards`} className="text-sm font-bold">
					<Trans>Open roles</Trans>
				</h3>
				<p className="text-sm text-ink-2">
					<Trans>
						Most companies list their jobs on Greenhouse, Ashby or Lever. Watch the company's page there, and its new
						roles that match your Preferences show up in New roles on Career → Today.
					</Trans>
				</p>
			</div>

			{!data ? (
				<p role="status" className="text-sm text-ink-2">
					{query.isError ? <Trans>Couldn't load this company's open roles.</Trans> : <Trans>Loading…</Trans>}
				</p>
			) : (
				<>
					{data.watched.map((board) => (
						<div
							key={board.id}
							className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-line px-2.5 py-1.5 text-[13px]"
						>
							<p className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
								<span className="font-semibold">{t`Watching on ${platform(board.ats)}`}</span>{" "}
								<span className="text-ink-2">
									{board.error
										? `· ${t`The last check failed. Its last postings are kept, and the next check tries again.`}`
										: board.fetchedAt
											? `· ${t`${board.jobCount ?? 0} open`} · ${t`checked ${lower(relative(board.fetchedAt))}`}`
											: `· ${t`not checked yet`}`}
								</span>
							</p>
							<OpenOn ats={board.ats} url={board.url} />
							<Button
								variant="secondary"
								size="sm"
								loading={unwatch.isPending && unwatch.variables?.id === board.id}
								onClick={() => unwatch.mutate({ id: board.id })}
							>
								<Trans>Stop watching</Trans>
							</Button>
						</div>
					))}

					{data.watched.length > 0 && schedules.data && !hasSchedule && (
						<p className="text-sm text-warn-text">
							<Trans>Nothing checks watched companies yet.</Trans>{" "}
							<Link to="/dashboard/career" search={{ schedule: "new:boards" }} className="underline underline-offset-2">
								<Trans>Add a Watched companies schedule</Trans>
							</Link>
						</p>
					)}

					{data.detected.map((board) => (
						<div
							key={`${board.ats}:${board.region}:${board.slug}`}
							className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-dashed border-line-2 px-2.5 py-1.5 text-[13px]"
						>
							<p className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
								<span className="font-semibold">{t`Found on ${platform(board.ats)}`}</span>{" "}
								<span className="text-ink-2">
									· {t`from a posting link on file`}
									{board.jobCount !== null && ` · ${t`${board.jobCount} open`}`}
								</span>
							</p>
							<OpenOn ats={board.ats} url={board.url} />
							<Button size="sm" loading={confirming(board.slug)} onClick={() => confirm(board, "posting")}>
								<Trans>Confirm</Trans>
							</Button>
						</div>
					))}

					<form
						className="flex flex-wrap gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							if (link.trim()) fromLink.mutate({ companyId, link: link.trim() });
						}}
					>
						<Input
							type="url"
							className="max-w-md min-w-60 flex-1"
							aria-label={t`The company's careers link`}
							placeholder={t`Paste the company's careers link`}
							value={link}
							onChange={(event) => setLink(event.target.value)}
						/>
						<Button type="submit" variant="secondary" disabled={!link.trim()} loading={fromLink.isPending}>
							<Trans>Look up</Trans>
						</Button>
						<Button
							type="button"
							variant="secondary"
							loading={guess.isPending}
							onClick={() => guess.mutate({ companyId })}
						>
							<Trans>Find it for me</Trans>
						</Button>
					</form>

					{found && (
						<div role="status" className="grid gap-2">
							{found.boards.length === 0 ? (
								<p className="text-sm text-ink-2">
									{found.source === "guess" ? (
										<Trans>Nothing found from the name. Paste the company's careers link instead.</Trans>
									) : (
										<Trans>No Greenhouse, Ashby or Lever jobs found at that link.</Trans>
									)}
								</p>
							) : (
								<>
									<p className="text-sm text-ink-2">
										{found.source === "guess" ? (
											<Trans>
												A guess can find another company's jobs. Check the name and roles before confirming.
											</Trans>
										) : (
											<Trans>Confirm to watch it.</Trans>
										)}
									</p>
									{found.boards.map((board) => (
										<div
											key={`${board.ats}:${board.region}:${board.slug}`}
											className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-line px-2.5 py-1.5 text-[13px]"
										>
											<div className="grid min-w-0 basis-full gap-0.5 sm:flex-1 sm:basis-auto">
												<p>
													<span className="font-semibold">{platform(board.ats)}</span>
													{board.name && ` · ${board.name}`}
													<span className="text-ink-2"> · {t`${board.jobCount} open`}</span>
												</p>
												{board.sample.length > 0 && (
													<p className="truncate text-xs text-ink-2">{board.sample.join(" · ")}</p>
												)}
											</div>
											<OpenOn ats={board.ats} url={board.url} />
											{watchedKeys.has(boardKey(board)) ? (
												<p className="self-center text-sm text-ink-2">
													<Trans>Already watching</Trans>
												</p>
											) : (
												<Button size="sm" loading={confirming(board.slug)} onClick={() => confirm(board, found.source)}>
													<Trans>Confirm</Trans>
												</Button>
											)}
										</div>
									))}
								</>
							)}
						</div>
					)}
				</>
			)}
		</section>
	);
}

type OpenOnProps = { ats: BoardAts; url: string };
function OpenOn({ ats, url }: OpenOnProps) {
	return (
		<Button
			variant="ghost"
			size="sm"
			nativeButton={false}
			render={<a href={url} target="_blank" rel="noopener noreferrer" />}
		>
			{t`Open on ${platform(ats)}`} ↗
		</Button>
	);
}

/**
 * Companies worth watching, from the contacts in the Directory: most contacts first, with their matching open roles
 * where a posting link on file names their jobs page. One line with the top three; Show all opens the full list in
 * place. Nothing is watched until the user confirms a page.
 */
export function WatchSuggestions() {
	const id = useId();
	const [open, setOpen] = useState(false);
	const query = useQuery(orpc.boards.suggestions.queryOptions({ input: {} }));
	const rows = query.data;
	if (query.isError || !rows || rows.length === 0) return null;
	const top = rows.slice(0, 3);
	const more = rows.length - top.length;
	const companyLink = (row: (typeof rows)[number]) => (
		<Link
			to="/dashboard/directory"
			search={{ tab: "companies", company: row.id }}
			className="text-accent-text underline-offset-2 hover:underline"
		>
			{row.name}
		</Link>
	);
	return (
		<section
			aria-labelledby={`${id}-watch`}
			className="grid gap-2 rounded-md border border-line px-2.5 py-1.5 text-[13px]"
		>
			<div className="flex min-w-0 items-center gap-2">
				<h2 id={`${id}-watch`} className="shrink-0 font-bold">
					<Trans>Companies to watch</Trans>
				</h2>
				{!open && (
					<p className="min-w-0 flex-1 truncate text-ink-2">
						{top.map((row, index) => (
							<span key={row.id}>
								{index > 0 && " · "}
								{companyLink(row)}{" "}
								{index === 0 ? (row.contacts === 1 ? t`1 contact` : t`${row.contacts} contacts`) : row.contacts}
							</span>
						))}
						{more > 0 && ` · ${t`and ${more} more`}`}
					</p>
				)}
				<Button
					variant="link"
					className="ms-auto shrink-0 text-[13px]"
					aria-expanded={open}
					aria-controls={`${id}-all`}
					onClick={() => setOpen((value) => !value)}
				>
					{open ? <Trans>Show less</Trans> : <Trans>Show all</Trans>}
					<Icon name="caret-down" size={12} className={open ? "rotate-180" : undefined} />
				</Button>
			</div>
			{open && (
				<div id={`${id}-all`} className="grid gap-1.5 pb-1">
					<p className="text-ink-2">
						<Trans>
							Where you know people, most contacts first. Open one to find and confirm where it lists its jobs.
						</Trans>
					</p>
					<ul className="grid gap-1.5">
						{rows.map((row) => (
							<li key={row.id} className="flex flex-wrap items-baseline gap-x-2">
								<span className="font-semibold">{companyLink(row)}</span>
								<span className="text-ink-2">
									{row.contacts === 1 ? t`1 contact` : t`${row.contacts} contacts`}
									{row.openRoles !== null &&
										` · ${row.openRoles === 1 ? t`1 matching open role` : t`${row.openRoles} matching open roles`}`}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	);
}
