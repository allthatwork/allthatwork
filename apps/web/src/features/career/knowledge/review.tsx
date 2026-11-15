import type { Fact } from "../hooks";
import type { KnowledgeFinding } from "@reactive-resume/schema/career";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { useDefaultProvider } from "../hooks";
import { CareerLoadError, CareerLoading } from "../load-state";
import { PrivacyLine, useCareerTime, Working } from "../shared";
import { SectionHeading } from "@/components/calm/section-heading";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

const FACTS_INPUT = { applicationId: null, all: true };

const kindLabel = (kind: KnowledgeFinding["kind"]) =>
	({
		contradiction: t`These disagree`,
		superseded: t`A newer fact replaces an older one`,
		unsupported: t`Nothing to check it by`,
	})[kind];

/**
 * Curate: an AI read of the shared facts for contradictions, figures a newer fact replaces and claims with nothing
 * behind them. Copies of shared facts are removed first; only judgment calls are listed, for the user to decide.
 */
export function ReviewCard() {
	const id = useId();
	const queryClient = useQueryClient();
	const { format } = useCareerTime();
	const connection = useDefaultProvider();
	const review = useQuery(orpc.career.review.queryOptions());
	const facts = useQuery(orpc.career.facts.queryOptions({ input: FACTS_INPUT }));
	const refresh = () => {
		for (const key of [
			orpc.career.review.key(),
			orpc.career.facts.key(),
			orpc.career.stories.key(),
			orpc.career.duplicates.key(),
			orpc.career.factGroups.key(),
		])
			void queryClient.invalidateQueries({ queryKey: key });
	};
	const run = useMutation({
		...orpc.career.runReview.mutationOptions(),
		onSuccess: (result) => queryClient.setQueryData(orpc.career.review.queryKey(), result),
		onError: (error) =>
			toast.add({ type: "error", description: getOrpcErrorMessage(error, { fallback: t`The review didn't finish.` }) }),
		onSettled: refresh,
	});
	const resolve = useMutation({
		mutationFn: async (input: { finding: KnowledgeFinding; archive: string[]; resolved: "fixed" | "dismissed" }) => {
			for (const factId of input.archive) await client.career.updateFact({ id: factId, status: "archived" });
			return client.career.resolveFinding({ id: input.finding.id, resolved: input.resolved });
		},
		onSuccess: (result) => queryClient.setQueryData(orpc.career.review.queryKey(), result),
		onError: (error) =>
			toast.add({
				type: "error",
				description: getOrpcErrorMessage(error, { fallback: t`Couldn't save that change.` }),
			}),
		onSettled: refresh,
	});

	if (review.isPending || facts.isPending) return <CareerLoading />;
	if (review.isError || facts.isError)
		return (
			<CareerLoadError
				onRetry={() => {
					void review.refetch();
					void facts.refetch();
				}}
			/>
		);
	const byId = new Map<string, Fact>(facts.data.map((fact) => [fact.id, fact]));
	const last = review.data;
	// A finding goes away once it's settled, or once a fact in it is archived or forgotten.
	const open =
		last?.findings.filter(
			(finding) =>
				finding.resolved === null &&
				finding.factIds.every((factId) => {
					const status = byId.get(factId)?.status;
					return status === "active" || status === "excluded";
				}),
		) ?? [];

	return (
		<section aria-labelledby={`${id}-title`}>
			<SectionHeading id={`${id}-title`}>
				<Trans>Knowledge review</Trans>
			</SectionHeading>
			<div className="flex flex-col gap-2 pb-3">
				<div className="flex flex-wrap items-start gap-x-6 gap-y-3">
					<p className="min-w-0 flex-1 basis-80 t-small text-ink-3">
						<Trans>
							Removes copies of shared facts, then asks your AI connection which facts disagree, which a newer fact
							replaces, and which claim a result with nothing to check it by. You decide what to do with each.
						</Trans>
					</p>
					{connection.provider && (
						<Button size="sm" variant="secondary" loading={run.isPending} onClick={() => run.mutate({})}>
							{!run.isPending && <Icon name="sparkle" />}
							{last ? <Trans>Review again</Trans> : <Trans>Review my Knowledge</Trans>}
						</Button>
					)}
				</div>
				{connection.provider ? (
					<PrivacyLine>
						{t`Sends your shared, switched-on facts to ${connection.provider.label}, in requests within your AI limits. Private groups and switched-off facts are never sent.`}
					</PrivacyLine>
				) : (
					!connection.isUnavailable && (
						<Link
							to="/dashboard/settings/ai"
							className="touch-target relative flex w-fit items-center gap-1.5 text-[13px]/[18px] font-medium text-accent-text underline-offset-4 hover:underline"
						>
							<Icon name="key" size={16} />
							<Trans>Connect an AI provider in Settings</Trans>
						</Link>
					)
				)}
			</div>

			{run.isPending && (
				<div className="border-t border-line py-4">
					<Working steps={[t`Removing copies`, t`Reading your facts`, t`Checking for conflicts`]} />
				</div>
			)}

			{last && !run.isPending && (
				<>
					<p className="border-y border-line py-2.5 t-small text-ink-3">
						{t`Last review ${format(last.at, { day: "numeric", month: "short" })} on ${last.connection}: read ${last.reviewed} of ${last.total} facts.`}{" "}
						{last.cleaned > 0 && plural(last.cleaned, { one: "Removed # copy.", other: "Removed # copies." })}
						{last.reviewed < last.total && <> {t`Raise "Facts in each action" in AI limits to read the rest.`}</>}
					</p>
					{open.length === 0 ? (
						<p className="border-b border-line py-4 t-small text-ink-3">
							<Trans>Nothing left to decide.</Trans>
						</p>
					) : (
						<ul className="flex flex-col">
							{open.map((finding) => (
								<li key={finding.id} className="flex flex-col gap-2.5 border-b border-line py-4 last:border-b-0">
									<p className="t-small text-ink-3">{kindLabel(finding.kind)}</p>
									<p className="text-[15px]/[22px] font-medium [overflow-wrap:anywhere] text-ink">{finding.note}</p>
									{/* The facts in a finding hang under it, as a setting's own rows do (passkeys, devices). */}
									<ul className="flex flex-col">
										{finding.factIds.map((factId) => (
											<li
												key={factId}
												className="ms-2 flex min-h-11 flex-wrap items-center gap-x-3.5 gap-y-1 border-s border-line-2 py-1.5 ps-5 t-ui"
											>
												<span className="min-w-0 flex-1 basis-60 [overflow-wrap:anywhere]">
													{byId.get(factId)?.text}
													{finding.keep === factId && <span className="ms-1.5 t-small text-ink-3">{t`(newer)`}</span>}
												</span>
												{finding.kind !== "unsupported" && (
													<Button
														size="sm"
														variant="ghost"
														disabled={resolve.isPending}
														onClick={() => resolve.mutate({ finding, archive: [factId], resolved: "fixed" })}
													>
														<Trans>Archive this one</Trans>
													</Button>
												)}
												{finding.kind === "unsupported" && (
													<Button
														size="sm"
														variant="ghost"
														nativeButton={false}
														render={<Link to="/dashboard/career/knowledge/facts" search={{ highlight: factId }} />}
													>
														<Trans>Correct it</Trans>
													</Button>
												)}
											</li>
										))}
									</ul>
									<div className="flex flex-wrap gap-1.5">
										{finding.kind === "superseded" && finding.keep && (
											<Button
												size="sm"
												variant="secondary"
												disabled={resolve.isPending}
												onClick={() =>
													resolve.mutate({
														finding,
														archive: finding.factIds.filter((factId) => factId !== finding.keep),
														resolved: "fixed",
													})
												}
											>
												<Trans>Keep the newer one</Trans>
											</Button>
										)}
										<Button
											size="sm"
											variant="ghost"
											className="text-ink-2"
											disabled={resolve.isPending}
											onClick={() => resolve.mutate({ finding, archive: [], resolved: "dismissed" })}
										>
											<Trans>Not a problem</Trans>
										</Button>
									</div>
								</li>
							))}
						</ul>
					)}
				</>
			)}
		</section>
	);
}
