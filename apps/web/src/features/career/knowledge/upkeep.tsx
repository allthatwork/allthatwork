import type { Fact, Story } from "../hooks";
import type { RouterOutput } from "@/libs/orpc/client";
import type { StoryIssue } from "@reactive-resume/utils/knowledge";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { toast } from "@reactive-resume/ui/components/toast";
import { storyIssues } from "@reactive-resume/utils/knowledge";
import { cn } from "@reactive-resume/utils/style";
import { CareerLoadError, CareerLoading } from "../load-state";
import { useKnowledgeRules } from "./groups";
import { SectionHeading } from "@/components/calm/section-heading";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type Duplicates = RouterOutput["career"]["duplicates"];
type DuplicateFact = Duplicates["facts"][number];

/** A flat row of the upkeep lists: a hairline under each one, none under the last. */
const rowClassName = "flex flex-col gap-2.5 border-b border-line py-4 last:border-b-0";

const DISMISSED_KEY = "curate:not-duplicates";
const readDismissed = () => {
	try {
		return new Set<string>(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as string[]);
	} catch {
		return new Set<string>();
	}
};

/** Every query a merge or cleanup changes. */
function useRefreshKnowledge() {
	const queryClient = useQueryClient();
	return () => {
		for (const key of [
			orpc.career.duplicates.key(),
			orpc.career.facts.key(),
			orpc.career.stories.key(),
			orpc.career.factGroups.key(),
			orpc.career.overrides.key(),
		])
			void queryClient.invalidateQueries({ queryKey: key });
	};
}

/** Curate: copies of shared facts in applications, and facts that say the same thing twice. */
export function DuplicatesCard() {
	const id = useId();
	const refresh = useRefreshKnowledge();
	const query = useQuery(orpc.career.duplicates.queryOptions());
	const [dismissed, setDismissed] = useState(readDismissed);
	const [shown, setShown] = useState(10);
	const onError = (error: Error) =>
		toast.add({ type: "error", description: getOrpcErrorMessage(error, { fallback: t`Couldn't merge those facts.` }) });
	const clean = useMutation({
		...orpc.career.cleanDuplicates.mutationOptions(),
		onSuccess: ({ updated }) =>
			toast.add({
				type: "success",
				description: plural(updated, { one: "Removed # copy.", other: "Removed # copies." }),
			}),
		onError,
		onSettled: refresh,
	});
	const merge = useMutation({
		mutationFn: async (input: { into: string; ids: string[] }) => {
			for (const factId of input.ids) await client.career.mergeFact({ id: factId, into: input.into });
		},
		onError,
		onSettled: refresh,
	});

	if (!query.data) return query.isError ? <CareerLoadError onRetry={() => void query.refetch()} /> : <CareerLoading />;
	const facts = new Map(query.data.facts.map((fact) => [fact.id, fact]));
	// Copies private to an application of a shared fact: one click folds them into the shared one.
	const copies = query.data.exact.flatMap((set) =>
		facts.get(set.keep)?.applicationId === null
			? set.copies.filter((factId) => facts.get(factId)?.applicationId !== null)
			: [],
	);
	const sets = query.data.exact
		.map((set) => ({
			keep: set.keep,
			copies: set.copies.filter((factId) => !copies.includes(factId)),
		}))
		.filter((set) => set.copies.length > 0);
	const near = query.data.near.filter((pair) => !dismissed.has(pair.factIds.join(":")));
	const dismiss = (key: string) => {
		const next = new Set(dismissed).add(key);
		setDismissed(next);
		try {
			localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
		} catch {
			// Without storage the pair is only hidden until the page reloads.
		}
	};
	const busy = clean.isPending || merge.isPending;

	return (
		<section aria-labelledby={`${id}-title`}>
			<SectionHeading id={`${id}-title`}>
				<Trans>Duplicates</Trans>
			</SectionHeading>
			<p className="pb-2 t-small text-ink-3">
				<Trans>
					A fact said twice takes twice the budget. Keeping one archives the other: it's hidden and never sent, and you
					can restore it from Archived in Facts. Its stories, saved work and per-job choices move to the one you keep.
				</Trans>
			</p>

			{copies.length === 0 && sets.length === 0 && near.length === 0 && (
				<p className="border-b border-line py-4 t-small text-ink-3">
					<Trans>No duplicates found.</Trans>
				</p>
			)}

			<div className="flex flex-col">
				{copies.length > 0 && (
					<div className={rowClassName}>
						<div className="flex flex-wrap items-center gap-3">
							<p className="min-w-0 flex-1 basis-60 t-ui text-ink">
								{plural(copies.length, {
									one: "# application fact is a word-for-word copy of a shared fact, which already reaches that application.",
									other:
										"# application facts are word-for-word copies of shared facts, which already reach those applications.",
								})}
							</p>
							<Button
								size="sm"
								variant="secondary"
								loading={clean.isPending}
								disabled={busy}
								onClick={() => clean.mutate({})}
							>
								<Trans>Remove copies</Trans>
							</Button>
						</div>
					</div>
				)}

				{sets.map((set) => (
					<div key={set.keep} className={rowClassName}>
						<p className="t-small text-ink-3">{plural(set.copies.length + 1, { other: "Said # times" })}</p>
						<FactQuote fact={facts.get(set.keep)} />
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
							<Button
								size="sm"
								variant="secondary"
								disabled={busy}
								loading={merge.isPending && merge.variables.into === set.keep}
								onClick={() => merge.mutate({ into: set.keep, ids: set.copies })}
							>
								{plural(set.copies.length, { one: "Keep one, archive # copy", other: "Keep one, archive # copies" })}
							</Button>
							<span className="t-small text-ink-3">
								<Trans>Keeps the oldest one that's switched on.</Trans>
							</span>
						</div>
					</div>
				))}

				{near.slice(0, shown).map((pair) => {
					const [left, right] = pair.factIds.map((factId) => facts.get(factId));
					const key = pair.factIds.join(":");
					if (!left || !right) return null;
					const percent = Math.round(pair.similarity * 100);
					// Keeping a job's own fact over a shared one makes it shared, as the server does, so no job loses it.
					const becomesShared = (keep: DuplicateFact, other: DuplicateFact) =>
						keep.applicationId !== null && keep.applicationId !== other.applicationId;
					// The note row is shared by both sides; without a note on either, it isn't there to add space.
					const noted = becomesShared(left, right) || becomesShared(right, left);
					return (
						<div key={key} className={rowClassName}>
							<p className="t-small text-ink-3">
								{pair.contained
									? t`The longer one says almost everything the shorter one does · ${percent}%`
									: t`Nearly the same words · ${percent}%`}
							</p>
							{/* Both sides share the rows (text, button, note), so the buttons line up whichever side has a note. */}
							<div className="grid gap-y-4 sm:grid-cols-2">
								{[
									[left, right],
									[right, left],
								].map(([keep, other]) =>
									keep && other ? (
										<div
											key={keep.id}
											className={cn(
												"grid grid-rows-subgrid justify-items-start gap-y-2 not-first:border-line max-sm:not-first:border-t max-sm:not-first:pt-4 sm:not-first:border-s sm:not-first:ps-5 first:sm:pe-5",
												noted ? "row-span-3" : "row-span-2",
											)}
										>
											<FactQuote fact={keep} />
											<Button
												size="sm"
												variant="secondary"
												disabled={busy}
												onClick={() => merge.mutate({ into: keep.id, ids: [other.id] })}
											>
												<Trans>Keep this, archive the other</Trans>
											</Button>
											{noted && (
												<span className="t-small text-ink-3">
													{becomesShared(keep, other) && (
														<Trans>This one becomes shared, so every application gets it.</Trans>
													)}
												</span>
											)}
										</div>
									) : null,
								)}
							</div>
							<Button
								size="sm"
								variant="ghost"
								className="-ms-2.5 self-start justify-self-start text-ink-2"
								onClick={() => dismiss(key)}
							>
								<Trans>Not duplicates, keep both</Trans>
							</Button>
						</div>
					);
				})}
			</div>
			{near.length > shown && (
				<div className="pt-2">
					<Button size="sm" variant="ghost" className="-ms-2.5" onClick={() => setShown((count) => count + 10)}>
						{t`Show more (${near.length - shown})`}
					</Button>
				</div>
			)}
		</section>
	);
}

type FactQuoteProps = { fact: DuplicateFact | undefined };

function FactQuote({ fact }: FactQuoteProps) {
	if (!fact) return null;
	const company = fact.company;
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<ClampedText text={fact.text} />
			<p className="t-small text-ink-3">
				{[
					fact.applicationId === null ? t`All applications` : company ? t`${company} only` : t`One application only`,
					fact.status === "active"
						? t({ message: "switched on", context: "A fact's switch: the AI can read it" })
						: t({ message: "switched off", context: "A fact's switch: the AI can't read it" }),
					fact.group,
				]
					.filter(Boolean)
					.join(" · ")}
			</p>
		</div>
	);
}

type ClampedTextProps = { text: string };

/**
 * A fact's text cut at four lines, so a pair of long facts doesn't make the page very tall. Show more opens it in
 * place; the button appears only when the text runs past four lines.
 */
export function ClampedText({ text }: ClampedTextProps) {
	const id = useId();
	const ref = useRef<HTMLParagraphElement>(null);
	const [open, setOpen] = useState(false);
	const [long, setLong] = useState(false);

	useLayoutEffect(() => {
		const element = ref.current;
		// Measured only while cut: open, the text has no limit to run past.
		if (!element || open) return;
		const measure = () => setLong(element.scrollHeight > element.clientHeight + 1);
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [open, text]);

	return (
		<div className="flex min-w-0 flex-col items-start gap-0.5">
			<p id={id} ref={ref} className={cn("t-ui [overflow-wrap:anywhere] text-ink", !open && "line-clamp-4")}>
				{text}
			</p>
			{(long || open) && (
				<button
					type="button"
					aria-expanded={open}
					aria-controls={id}
					onClick={() => setOpen((value) => !value)}
					className="touch-target relative text-[13px]/[18px] font-medium text-accent-text underline-offset-4 hover:underline"
				>
					{open ? <Trans>Show less</Trans> : <Trans>Show more</Trans>}
				</button>
			)}
		</div>
	);
}

const FACTS_INPUT = { applicationId: null, all: true };

/** Curate: stories the AI can't use, why, and a one-step confirmation when a fact behind one was corrected. */
export function StoriesCard() {
	const id = useId();
	const refresh = useRefreshKnowledge();
	const facts = useQuery(orpc.career.facts.queryOptions({ input: FACTS_INPUT }));
	const stories = useQuery(orpc.career.stories.queryOptions({ input: { applicationId: null } }));
	const { rules, loaded, isError, retry } = useKnowledgeRules(null);
	const confirm = useMutation({
		mutationFn: (story: Story) => client.career.saveStory({ ...story.data, id: story.id, applicationId: null }),
		onSuccess: () => toast.add({ type: "success", description: t`Story confirmed. The AI can use it again.` }),
		onError: (error) =>
			toast.add({ type: "error", description: getOrpcErrorMessage(error, { fallback: t`Couldn't save the story.` }) }),
		onSettled: refresh,
	});

	if (!facts.data || !stories.data || !loaded)
		return facts.isError || stories.isError || isError ? (
			<CareerLoadError
				onRetry={() => {
					void facts.refetch();
					void stories.refetch();
					retry();
				}}
			/>
		) : (
			<CareerLoading />
		);
	const byId = new Map<string, Fact>(facts.data.map((fact) => [fact.id, fact]));
	const blocked = stories.data
		.map((story) => ({ story, issues: storyIssues(story, byId, rules) }))
		.filter(({ issues }) => issues.length > 0);

	return (
		<section aria-labelledby={`${id}-title`}>
			<SectionHeading id={`${id}-title`}>
				<Trans>Stories the AI can't use</Trans>
			</SectionHeading>
			<p className="pb-2 t-small text-ink-3">
				<Trans>
					A story reaches the AI only while every fact behind it does, and none was corrected after the story was saved.
				</Trans>
			</p>
			{blocked.length === 0 ? (
				<p className="border-b border-line py-4 t-small text-ink-3">
					<Trans>Every story can be used.</Trans>
				</p>
			) : (
				<ul className="flex flex-col">
					{blocked.map(({ story, issues }) => {
						const onlyCorrections = issues.every((issue) => issue.reason === "corrected");
						return (
							<li key={story.id} className={rowClassName}>
								<p className="text-[15px]/[22px] font-medium [overflow-wrap:anywhere] text-ink">{story.data.title}</p>
								<ul className="flex flex-col gap-1.5">
									{issues.map((issue) => (
										<li key={`${issue.factId}-${issue.reason}`} className="t-small [overflow-wrap:anywhere] text-ink-2">
											<IssueText issue={issue} fact={byId.get(issue.factId)} />
										</li>
									))}
								</ul>
								<div className="flex flex-wrap gap-1.5">
									{onlyCorrections && (
										<Button
											size="sm"
											variant="secondary"
											loading={confirm.isPending && confirm.variables.id === story.id}
											disabled={confirm.isPending}
											onClick={() => confirm.mutate(story)}
										>
											<Trans>Still true, use it</Trans>
										</Button>
									)}
									<Button
										size="sm"
										variant="ghost"
										nativeButton={false}
										render={
											<Link
												to="/dashboard/career/knowledge/stories/{-$storyId}"
												params={{ storyId: story.id }}
												search={{ edit: true }}
											/>
										}
									>
										<Trans>Edit story</Trans>
									</Button>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}

type IssueTextProps = { issue: StoryIssue; fact: Fact | undefined };

function IssueText({ issue, fact }: IssueTextProps) {
	const quote = fact?.text ?? "";
	switch (issue.reason) {
		case "missing":
			return issue.factId ? (
				<Trans>A fact behind it was forgotten.</Trans>
			) : (
				<Trans>No facts back it. Edit it and tick the facts it rests on.</Trans>
			);
		case "archived":
			return <>{t`Archived: “${quote}”`}</>;
		case "private":
			return <>{t`In a private group: “${quote}”`}</>;
		case "off":
			return <>{t`Switched off: “${quote}”`}</>;
		case "corrected":
			return (
				<span className="grid gap-0.5">
					<span>{t`Corrected after the story was saved:`}</span>
					<span className="text-ink-3 line-through">{issue.before}</span>
					<span>{issue.after}</span>
				</span>
			);
	}
}
