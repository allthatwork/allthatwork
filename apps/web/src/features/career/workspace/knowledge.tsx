import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { Switch } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { groupTree } from "../knowledge/groups";
import { List, ListRow } from "@/components/calm/list-row";
import { SectionHeading } from "@/components/calm/section-heading";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type ApplicationKnowledgeProps = { applicationId: string };

/**
 * Which groups and facts this application's AI work reads beyond the global switches: private groups it includes, and
 * groups it includes or leaves out. Nothing is copied, so a correction to a fact applies here too.
 */
export function ApplicationKnowledge({ applicationId }: ApplicationKnowledgeProps) {
	const id = useId();
	const queryClient = useQueryClient();
	const groups = useQuery(orpc.career.factGroups.queryOptions());
	const overrides = useQuery(orpc.career.overrides.queryOptions({ input: { applicationId } }));
	const facts = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: null, all: true } }));
	const [picked, setPicked] = useState("");
	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: orpc.career.overrides.key() });
		void queryClient.invalidateQueries({ queryKey: orpc.career.savedItems.key() });
	};
	const onError = (error: Error) =>
		toast.add({
			type: "error",
			description: getOrpcErrorMessage(error, { fallback: t`Couldn't change this application's Knowledge.` }),
		});
	const save = useMutation({ ...orpc.career.saveOverride.mutationOptions(), onError, onSettled: refresh });
	const remove = useMutation({ ...orpc.career.deleteOverride.mutationOptions(), onError, onSettled: refresh });

	if (!groups.data || !overrides.data) return null;
	const tree = groupTree(groups.data);
	if (tree.length === 0 && overrides.data.length === 0) return null;
	const byGroup = new Map(overrides.data.flatMap((row) => (row.group ? [[row.group, row] as const] : [])));
	// Top-level private groups: the ones an application asks for.
	const privateGroups = tree.filter((node) => node.private && !node.privateFromParent);
	const others = overrides.data.filter(
		(row) => row.factId !== null || !privateGroups.some((node) => node.path === row.group && row.mode === "include"),
	);
	const factText = (factId: string) => facts.data?.find((fact) => fact.id === factId)?.text ?? t`A fact`;
	const choices = tree.filter((node) => !byGroup.has(node.path));
	const pending = save.isPending || remove.isPending;

	return (
		<section aria-labelledby={`${id}-title`} className="grid">
			<SectionHeading id={`${id}-title`} className="pt-0">
				<Trans>Knowledge for this job</Trans>
			</SectionHeading>
			<List>
				{privateGroups.map((node) => {
					const included = byGroup.get(node.path);
					return (
						<ListRow
							key={node.path}
							leading={<Icon name="lock" size={18} className="flex-none text-ink-3" />}
							title={node.path}
							subtitle={included?.mode === "include" ? t`Included for this job` : t`Private, not sent`}
							trailing={
								<Switch
									checked={included?.mode === "include"}
									disabled={pending}
									aria-label={t`Include ${node.path} for this job`}
									onCheckedChange={(checked) =>
										checked
											? save.mutate({ applicationId, group: node.path, mode: "include" })
											: included && remove.mutate({ id: included.id })
									}
								/>
							}
						/>
					);
				})}

				{others.map((row) => (
					<ListRow
						key={row.id}
						leading={
							<Icon name={row.factId ? "list-checks" : "folder-simple"} size={18} className="flex-none text-ink-3" />
						}
						title={row.factId ? factText(row.factId) : row.group}
						subtitle={row.mode === "include" ? t`Included for this job` : t`Left out for this job`}
						trailing={
							<Button
								variant="link"
								className="leading-5"
								disabled={pending}
								onClick={() => remove.mutate({ id: row.id })}
							>
								<Trans>Undo</Trans>
							</Button>
						}
					/>
				))}

				{choices.length > 0 && (
					<div className="flex flex-wrap items-center gap-2 border-b border-line py-3 last:border-b-0">
						<div className="min-w-0 flex-1 basis-40">
							<NativeSelect
								aria-label={t`Another group`}
								value={picked}
								onChange={(event) => setPicked(event.target.value)}
								className="w-full"
							>
								<option value="">{t`Another group…`}</option>
								{choices.map((node) => (
									<option key={node.path} value={node.path}>
										{node.path}
									</option>
								))}
							</NativeSelect>
						</div>
						<Button
							variant="secondary"
							disabled={!picked || pending}
							onClick={() => {
								save.mutate({ applicationId, group: picked, mode: "include" });
								setPicked("");
							}}
						>
							<Trans>Include</Trans>
						</Button>
						<Button
							variant="ghost"
							className="text-ink-2"
							disabled={!picked || pending}
							onClick={() => {
								save.mutate({ applicationId, group: picked, mode: "exclude" });
								setPicked("");
							}}
						>
							<Trans>Leave out</Trans>
						</Button>
					</div>
				)}
			</List>
			<p className="pt-2 text-[13px]/[18px] text-ink-3">
				<Trans>Only this job's Fit, Apply, Prepare and coach use these. Nothing is copied.</Trans>
			</p>
		</section>
	);
}
