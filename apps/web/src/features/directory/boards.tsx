import type { RouterOutput } from "@/libs/orpc/client";
import type { BoardAts, BoardSource } from "@reactive-resume/schema/boards";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { useCareerTime } from "@/features/career/shared";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type Candidate = RouterOutput["boards"]["guess"][number];

const ATS_NAMES: Record<BoardAts, string> = { greenhouse: "Greenhouse", ashby: "Ashby", lever: "Lever" };
const atsLabel = (ats: BoardAts, region: string) => `${ATS_NAMES[ats]}${region === "eu" ? " EU" : ""}`;

const failed = (error: unknown, fallback: string) =>
	toast.add({ type: "error", description: getOrpcErrorMessage(error, { fallback, allowServerMessage: true }) });

type CompanyBoardsProps = { companyId: string; companyName: string };

/**
 * A company's Job board section: the boards watched for it, a board its posting links point at (to confirm), a
 * pasted careers link, and Find board, which tries name guesses. Every board found is shown for confirming; only a
 * confirmed board is watched and checked.
 */
export function CompanyBoards({ companyId, companyName }: CompanyBoardsProps) {
	const id = useId();
	const { when } = useCareerTime();
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
		onError: (error) => failed(error, t`Couldn't look for a board.`),
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
		onError: (error) => failed(error, t`Couldn't watch this board.`),
	});
	const unwatch = useMutation({
		...orpc.boards.unwatch.mutationOptions(),
		onSuccess: () => toast.add({ description: t`Stopped watching this board` }),
		onError: (error) => failed(error, t`Couldn't stop watching this board.`),
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
				<h3 id={`${id}-boards`} className="text-lg font-semibold">
					<Trans>Job board</Trans>
				</h3>
				<p className="text-sm text-ink-2">
					<Trans>
						Watch {companyName}'s Greenhouse, Ashby or Lever board, and board checks bring its new roles that match your
						preferences into New roles on Career → Today.
					</Trans>
				</p>
			</div>

			{!data ? (
				<p role="status" className="text-sm text-ink-2">
					{query.isError ? <Trans>Couldn't load this company's job boards.</Trans> : <Trans>Loading…</Trans>}
				</p>
			) : (
				<>
					{data.watched.map((board) => (
						<div key={board.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-line p-3.5">
							<div className="grid min-w-0 flex-1 gap-0.5">
								<p className="text-sm font-semibold">
									<Trans>Watching</Trans> · {atsLabel(board.ats, board.region)} · {board.name ?? board.slug}
								</p>
								<p className="text-xs text-ink-2">
									{board.error
										? t`The last check failed. Its last postings are kept, and the next check tries again.`
										: board.fetchedAt
											? t`${board.jobCount ?? 0} open roles · checked ${when(board.fetchedAt)}`
											: t`Not checked yet`}
								</p>
							</div>
							<Button
								variant="ghost"
								size="sm"
								nativeButton={false}
								render={<a href={board.url} target="_blank" rel="noopener noreferrer" />}
							>
								<Trans>Open board</Trans>
							</Button>
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
							<Trans>Nothing checks this board yet.</Trans>{" "}
							<Link to="/dashboard/career" search={{ schedule: "new:boards" }} className="underline underline-offset-2">
								<Trans>Add a board checks schedule</Trans>
							</Link>
						</p>
					)}

					{data.detected.map((board) => (
						<div
							key={`${board.ats}:${board.region}:${board.slug}`}
							className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line-2 p-3.5"
						>
							<p className="min-w-0 flex-1 text-sm">
								<Trans>From a posting link on file:</Trans>{" "}
								<span className="font-semibold">
									{atsLabel(board.ats, board.region)} · {board.slug}
								</span>
							</p>
							<Button
								variant="ghost"
								size="sm"
								nativeButton={false}
								render={<a href={board.url} target="_blank" rel="noopener noreferrer" />}
							>
								<Trans>Open board</Trans>
							</Button>
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
							aria-label={t`Careers or job board link`}
							placeholder={t`Paste a careers or job board link`}
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
							<Trans>Find board</Trans>
						</Button>
					</form>

					{found && (
						<div role="status" className="grid gap-2">
							{found.boards.length === 0 ? (
								<p className="text-sm text-ink-2">
									{found.source === "guess" ? (
										<Trans>No board found from the name. Paste the company's careers page link instead.</Trans>
									) : (
										<Trans>No Greenhouse, Ashby or Lever board found at that link.</Trans>
									)}
								</p>
							) : (
								<>
									<p className="text-sm text-ink-2">
										{found.source === "guess" ? (
											<Trans>
												A guess can find another company's board. Check the name and roles before confirming.
											</Trans>
										) : (
											<Trans>Confirm the board to watch it.</Trans>
										)}
									</p>
									{found.boards.map((board) => (
										<div
											key={`${board.ats}:${board.region}:${board.slug}`}
											className="flex flex-wrap items-start gap-3 rounded-xl border border-line p-3.5"
										>
											<div className="grid min-w-0 flex-1 gap-0.5">
												<p className="text-sm font-semibold">
													{atsLabel(board.ats, board.region)} · {board.name ?? board.slug}
												</p>
												<p className="text-xs text-ink-2">
													{t`${board.jobCount} open roles`}
													{board.sample.length > 0 && ` · ${board.sample.join(" · ")}`}
												</p>
											</div>
											<Button
												variant="ghost"
												size="sm"
												nativeButton={false}
												render={<a href={board.url} target="_blank" rel="noopener noreferrer" />}
											>
												<Trans>Open board</Trans>
											</Button>
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

/**
 * Companies worth watching, from the contacts in the Directory: most contacts first, with their matching open roles
 * where a posting link on file names the board. Nothing is watched until the user confirms a board.
 */
export function WatchSuggestions() {
	const id = useId();
	const query = useQuery(orpc.boards.suggestions.queryOptions({ input: {} }));
	const rows = query.data;
	if (query.isError || (rows && rows.length === 0)) return null;
	return (
		<section aria-labelledby={`${id}-watch`} className="grid gap-2 rounded-xl border border-line p-4">
			<div className="grid gap-1">
				<h2 id={`${id}-watch`} className="text-base font-semibold">
					<Trans>Companies to watch</Trans>
				</h2>
				<p className="text-sm text-ink-2">
					<Trans>Where you know people, most contacts first. Open one to find and confirm its job board.</Trans>
				</p>
			</div>
			{!rows ? (
				<p role="status" className="text-sm text-ink-2">
					<Trans>Loading…</Trans>
				</p>
			) : (
				<ul className="grid gap-1.5">
					{rows.map((row) => (
						<li key={row.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
							<Link
								to="/dashboard/directory"
								search={{ tab: "companies", company: row.id }}
								className="font-semibold underline-offset-2 hover:underline"
							>
								{row.name}
							</Link>
							<span className="text-ink-2">
								{row.contacts === 1 ? t`1 contact` : t`${row.contacts} contacts`}
								{row.openRoles !== null &&
									` · ${row.openRoles === 1 ? t`1 matching open role` : t`${row.openRoles} matching open roles`}`}
							</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
