import type { RouterOutput } from "@/libs/orpc/client";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Switch } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { groupAncestors, type KnowledgeRules, nearestGroupSetting } from "@reactive-resume/utils/knowledge";
import { cn } from "@reactive-resume/utils/style";
import { CareerLoadError, CareerLoading } from "../load-state";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

export type FactGroup = RouterOutput["career"]["factGroups"][number];

/**
 * Private groups, and in an application its overrides: with each fact's switch, what decides whether the AI reads it.
 * Same rules as the server's career context (`reachesAi`).
 */
export function useKnowledgeRules(applicationId: string | null) {
	const groups = useQuery(orpc.career.factGroups.queryOptions());
	const overrides = useQuery({
		...orpc.career.overrides.queryOptions({ input: { applicationId: applicationId ?? "" } }),
		enabled: applicationId !== null,
	});
	const rules: KnowledgeRules = {
		privateGroups: (groups.data ?? []).flatMap((entry) => (entry.private && entry.group ? [entry.group] : [])),
		overrides: applicationId === null ? [] : (overrides.data ?? []),
	};
	return {
		rules,
		loaded: groups.isSuccess && (applicationId === null || overrides.isSuccess),
		isError: groups.isError || overrides.isError,
		retry: () => {
			void groups.refetch();
			if (applicationId !== null) void overrides.refetch();
		},
	};
}

export type GroupNode = {
	path: string;
	name: string;
	depth: number;
	/** How this group itself was last switched; null when it follows its parent or was never switched. */
	status: FactGroup["status"];
	/** How facts added to it later start: its own setting, else its nearest parent's, else on (the server's rule). */
	startsAs: "active" | "excluded";
	/** Marked private itself. */
	private: boolean;
	/** Private because a group above it is. */
	privateFromParent: boolean;
	/** The nearest group above it that's private, when there is one. */
	privateThrough: string | null;
	/** Its own facts and every subgroup's. */
	facts: { active: number; excluded: number };
	activeChars: number;
};

/** Groups as a tree in path order, each with its subgroups' facts counted in, including parents with no facts of their own. */
export function groupTree(groups: readonly FactGroup[]): GroupNode[] {
	const nodes = new Map<string, GroupNode>();
	for (const entry of groups) {
		if (entry.group === null) continue;
		for (const path of groupAncestors(entry.group)) {
			let node = nodes.get(path);
			if (!node) {
				const parts = path.split("/");
				nodes.set(
					path,
					(node = {
						path,
						name: parts.at(-1) ?? path,
						depth: parts.length - 1,
						status: null,
						startsAs: "active",
						private: false,
						privateFromParent: false,
						privateThrough: null,
						facts: { active: 0, excluded: 0 },
						activeChars: 0,
					}),
				);
			}
			node.facts.active += entry.facts.active;
			node.facts.excluded += entry.facts.excluded;
			node.activeChars += entry.activeChars;
			if (path === entry.group) {
				node.status = entry.status;
				node.private = entry.private;
			}
		}
	}
	const settings = new Map(
		[...nodes.values()].flatMap((node) => (node.status ? [[node.path, node.status] as const] : [])),
	);
	for (const node of nodes.values()) {
		node.startsAs = nearestGroupSetting(node.path, settings) === "excluded" ? "excluded" : "active";
		node.privateThrough =
			groupAncestors(node.path)
				.slice(1)
				.find((path) => nodes.get(path)?.private === true) ?? null;
		node.privateFromParent = node.privateThrough !== null;
	}
	// Siblings sort by name under their parent: "a/b" before "a b", which plain string order would swap.
	return [...nodes.values()].sort((a, b) => {
		const left = a.path.split("/");
		const right = b.path.split("/");
		for (let index = 0; index < Math.min(left.length, right.length); index++) {
			const order = (left[index] ?? "").localeCompare(right[index] ?? "");
			if (order !== 0) return order;
		}
		return left.length - right.length;
	});
}

/** The line under a group's name, before its new-facts default: its count, and whether it's private or what it adds. */
export function groupMeta(node: GroupNode, number: Intl.NumberFormat): string {
	const { active, excluded } = node.facts;
	const total = active + excluded;
	const on = active > 0;
	return [
		total === 0
			? t`No facts`
			: on && excluded > 0
				? t`${number.format(active)} on · ${number.format(excluded)} off`
				: plural(total, { one: "# fact", other: "# facts" }),
		node.private
			? t`private`
			: node.privateThrough !== null
				? t`private through ${node.privateThrough}`
				: on
					? t`${number.format(node.activeChars)} characters`
					: t`nothing sent`,
	].join(" · ");
}

/** Curate: switch whole groups of facts on or off, with how much each one adds to the budget. */
export function GroupsCard() {
	const { i18n } = useLingui();
	const id = useId();
	const queryClient = useQueryClient();
	const query = useQuery(orpc.career.factGroups.queryOptions());
	const number = new Intl.NumberFormat(i18n.locale);
	const toggle = useMutation({
		...orpc.career.setFactGroupStatus.mutationOptions(),
		onSuccess: ({ updated }, { group, status }) =>
			toast.add({
				type: "success",
				description:
					status === "active"
						? plural(updated, {
								one: `Switched # fact in ${group} on.`,
								other: `Switched # facts in ${group} on.`,
							})
						: plural(updated, {
								one: `Switched # fact in ${group} off.`,
								other: `Switched # facts in ${group} off.`,
							}),
			}),
		onError: (error) =>
			toast.add({
				type: "error",
				description: getOrpcErrorMessage(error, { fallback: t`Couldn't switch that group.` }),
			}),
		onSettled: () => {
			void queryClient.invalidateQueries({ queryKey: orpc.career.factGroups.key() });
			void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
			void queryClient.invalidateQueries({ queryKey: orpc.career.stories.key() });
		},
	});
	const privacy = useMutation({
		...orpc.career.saveFactGroup.mutationOptions(),
		onError: (error) =>
			toast.add({
				type: "error",
				description: getOrpcErrorMessage(error, { fallback: t`Couldn't change that group.` }),
			}),
		onSettled: () => void queryClient.invalidateQueries({ queryKey: orpc.career.factGroups.key() }),
	});

	const defaults = useMutation({
		...orpc.career.saveFactGroup.mutationOptions(),
		onSuccess: (_, { group, status }) =>
			toast.add({
				type: "success",
				description:
					status === "excluded" ? t`New facts in ${group} now start off.` : t`New facts in ${group} now start on.`,
			}),
		onError: (error) =>
			toast.add({
				type: "error",
				description: getOrpcErrorMessage(error, { fallback: t`Couldn't change that group.` }),
			}),
		onSettled: () => void queryClient.invalidateQueries({ queryKey: orpc.career.factGroups.key() }),
	});

	if (!query.data) return query.isError ? <CareerLoadError onRetry={() => void query.refetch()} /> : <CareerLoading />;
	const tree = groupTree(query.data);
	const ungrouped = query.data.find((entry) => entry.group === null);

	return (
		<section aria-labelledby={`${id}-title`} className="overflow-hidden rounded-xl border border-line bg-surface">
			<header className="grid gap-0.5 border-b border-line px-4 py-3">
				<h2 id={`${id}-title`} className="flex items-center gap-2 text-sm font-semibold">
					<Icon name="folder-simple" size={20} className="text-ink-2" />
					<Trans>Groups</Trans>
				</h2>
				<p className="text-xs leading-[17px] text-ink-3">
					<Trans>
						Switch a group off to keep its facts out of what your AI provider gets, subgroups included. Facts you add to
						a group later start the way it's switched. Lock a group to make it private: it's never sent, whatever its
						switch says, unless an application includes it from its details. Put a fact in a group from its row in
						Facts.
					</Trans>
				</p>
			</header>
			{tree.length === 0 ? (
				<p className="px-4 py-5 text-center text-sm text-ink-3">
					<Trans>No groups yet. Give a fact a group in Facts, or set one through the API.</Trans>
				</p>
			) : (
				<ul>
					{tree.map((node) => {
						const total = node.facts.active + node.facts.excluded;
						const switching = toggle.isPending && toggle.variables?.group === node.path;
						// While a switch is saving, show where it's going rather than flicking back until the list reloads.
						const on = switching ? toggle.variables?.status === "active" : node.facts.active > 0;
						return (
							<li
								key={node.path}
								className="flex items-center gap-2 border-b border-line px-4 py-2.5 last:border-b-0"
								style={{ paddingInlineStart: `${16 + node.depth * 20}px` }}
							>
								<div className="grid min-w-0 flex-1 gap-0.5">
									<p className="truncate text-sm font-medium" title={node.path}>
										{node.name}
									</p>
									<p className="text-xs text-ink-3">
										{groupMeta(node, number)} · <Trans>new facts default:</Trans>{" "}
										<NewFactsDefault
											node={node}
											pending={defaults.isPending && defaults.variables?.group === node.path}
											saving={defaults.variables?.status}
											onChange={(status) => defaults.mutate({ group: node.path, status })}
										/>
									</p>
								</div>
								<PrivateLock
									node={node}
									pending={privacy.isPending && privacy.variables?.group === node.path}
									onChange={(locked) => privacy.mutate({ group: node.path, private: locked })}
								/>
								<Switch
									className="ms-1 me-0.5"
									checked={on}
									disabled={total === 0 || switching}
									aria-label={t`Switch ${node.path} on`}
									onCheckedChange={(checked) =>
										toggle.mutate({ group: node.path, status: checked ? "active" : "excluded", subgroups: true })
									}
								/>
							</li>
						);
					})}
				</ul>
			)}
			{ungrouped && (
				<p className="border-t border-line px-4 py-2.5 text-xs text-ink-3">
					{t`Not in a group: ${number.format(ungrouped.facts.active)} on · ${number.format(ungrouped.facts.excluded)} off`}
				</p>
			)}
		</section>
	);
}

type NewFactsDefaultProps = {
	node: GroupNode;
	pending: boolean;
	/** The value being saved, shown while `pending` so the word doesn't flick back until the list reloads. */
	saving: GroupNode["startsAs"] | undefined;
	onChange: (status: GroupNode["startsAs"]) => void;
};

/** How facts added to the group later start, green "on" or red "off"; a click flips it without switching any fact. */
function NewFactsDefault({ node, pending, saving, onChange }: NewFactsDefaultProps) {
	const value = pending && saving ? saving : node.startsAs;
	const on = value === "active";
	return (
		<button
			type="button"
			disabled={pending}
			aria-label={on ? t`New facts in ${node.path} default to on` : t`New facts in ${node.path} default to off`}
			onClick={() => onChange(on ? "excluded" : "active")}
			className={cn(
				"-mx-0.5 rounded-sm px-0.5 font-medium transition-colors duration-quick hover:bg-sunken disabled:cursor-progress disabled:opacity-50",
				on ? "text-success-text" : "text-danger-text",
			)}
		>
			{on ? t`on` : t`off`}
		</button>
	);
}

type PrivateLockProps = { node: GroupNode; pending: boolean; onChange: (locked: boolean) => void };

/** Private as a lock: open outline when not, solid in the accent when it is, dimmed when a parent makes it private. */
function PrivateLock({ node, pending, onChange }: PrivateLockProps) {
	const locked = node.private || node.privateFromParent;
	const tooltip =
		node.privateThrough !== null
			? t`Private because ${node.privateThrough} is`
			: node.private
				? t`Private: never sent unless an application includes it`
				: t`Make this group private`;
	return (
		<Tooltip>
			{/* Focusable while disabled (aria-disabled), so hover and keyboard still reach the tooltip. */}
			<TooltipTrigger
				render={
					<Button
						variant="ghost"
						size="icon-xs"
						aria-pressed={locked}
						aria-label={t`Keep ${node.path} private`}
						disabled={node.privateFromParent || pending}
						focusableWhenDisabled
						onClick={() => onChange(!node.private)}
						className={cn(
							"size-[30px] rounded-md hover:bg-sunken aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent",
							locked ? "text-accent-text" : "text-ink-3 hover:text-ink aria-disabled:hover:text-ink-3",
						)}
					/>
				}
			>
				<Icon name={locked ? "lock" : "lock-open"} filled={locked} size={20} />
			</TooltipTrigger>
			<TooltipContent>{tooltip}</TooltipContent>
		</Tooltip>
	);
}
