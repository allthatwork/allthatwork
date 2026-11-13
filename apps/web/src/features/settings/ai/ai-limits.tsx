import type { AiLimits } from "@reactive-resume/schema/career";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { aiLimitsSchema } from "@reactive-resume/schema/career";
import { Button } from "@reactive-resume/ui/components/button";
import { Input } from "@reactive-resume/ui/components/input";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { toast } from "@reactive-resume/ui/components/toast";
import { BudgetMeter } from "@/features/career/knowledge/budget";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

const DEFAULTS = aiLimitsSchema.parse({});
type Field = keyof AiLimits;

const bounds = (field: Field) => {
	const inner = aiLimitsSchema.shape[field].unwrap();
	const shape = "minValue" in inner ? inner : inner.unwrap();
	return { min: shape.minValue ?? 0, max: shape.maxValue ?? Number.MAX_SAFE_INTEGER };
};

/** A field that may be left blank: what the empty input shows, and what blank means in place of "Default …". */
type Blank = { placeholder: string; hint: string };

/**
 * One limit in a group: its field, its label and the unit after the input. Only a field whose default is blank (null
 * in the schema) has `blank`; every other field refuses an empty value.
 */
type LimitSpec = { name: Field; label: ReactNode; unit: string; blank?: Blank };
type LimitGroup = { legend: ReactNode; description?: ReactNode; limits: LimitSpec[] };

/** How much Knowledge goes with each AI request and how long it may run. Larger limits suit larger, slower models. */
export function AiLimitsSection() {
	const id = useId();
	const characters = t`characters`;
	const seconds = t`seconds`;
	const requirements = t`requirements`;
	const calls = t`calls`;
	const tokens = t`tokens`;
	const automatic = t`Automatic`;

	return (
		<section aria-labelledby={`${id}-title`} className="overflow-hidden rounded-xl border border-line bg-surface">
			<header className="grid gap-1 border-b border-line px-5 py-4 max-sm:px-4">
				<h2 id={`${id}-title`} className="text-[17px] font-semibold">
					<Trans>AI limits</Trans>
				</h2>
				<p className="max-w-[60ch] text-[13px] leading-5 text-ink-3">
					<Trans>
						How much of your switched-on Knowledge goes with each AI request, and how long a request may run. The
						defaults suit fast models with small context windows; raise them for models that can read more or need more
						time. Larger Knowledge limits send more of your Knowledge to your AI provider.
					</Trans>
				</p>
			</header>
			<div className="border-b border-line px-5 py-4 max-sm:px-4">
				<BudgetMeter bare />
			</div>
			<AiLimitsForm
				groups={[
					{
						legend: <Trans>Coach</Trans>,
						limits: [
							{ name: "coachFacts", label: <Trans>Facts shared with each message</Trans>, unit: t`facts` },
							{ name: "coachStories", label: <Trans>Stories shared with each message</Trans>, unit: t`stories` },
							{
								name: "searchFactChars",
								label: <Trans>Facts returned by one knowledge search</Trans>,
								unit: characters,
							},
							{
								name: "searchStoryChars",
								label: <Trans>Stories returned by one knowledge search</Trans>,
								unit: characters,
							},
							{
								name: "coachApplications",
								label: <Trans>Applications the Coach can list</Trans>,
								unit: t`applications`,
							},
							{
								name: "coachInterviews",
								label: <Trans>Interview debriefs the Coach can read</Trans>,
								unit: t`interviews`,
							},
						],
					},
					{
						legend: <Trans>Application actions</Trans>,
						description: (
							<Trans>
								Fit, Apply, Prepare, Practise, Debrief and Messages. Facts that best match the posting go in first.
							</Trans>
						),
						limits: [
							{ name: "actionFactChars", label: <Trans>Facts in each action</Trans>, unit: characters },
							{ name: "actionStoryChars", label: <Trans>Stories in each action</Trans>, unit: characters },
							{ name: "actionPostingChars", label: <Trans>Posting in each action</Trans>, unit: characters },
							{
								name: "actionRequirementChars",
								label: <Trans>Requirements in each action</Trans>,
								unit: characters,
							},
							{ name: "actionNotesChars", label: <Trans>Your notes in each action</Trans>, unit: characters },
							{
								name: "actionSearchNotesChars",
								label: <Trans>Job search notes in each action</Trans>,
								unit: characters,
							},
							{
								name: "actionTargetingNotesChars",
								label: <Trans>Targeting note in each action</Trans>,
								unit: characters,
							},
							{ name: "actionContactChars", label: <Trans>Contacts in each action</Trans>, unit: characters },
							{ name: "actionResumeChars", label: <Trans>Resume in each action</Trans>, unit: characters },
							{ name: "actionLetterChars", label: <Trans>Cover letter in each action</Trans>, unit: characters },
							{ name: "practiceStoryChars", label: <Trans>Story chosen in Practise</Trans>, unit: characters },
							{ name: "fitRequirements", label: <Trans>Requirements Fit scores</Trans>, unit: requirements },
							{
								name: "postingRequirements",
								label: <Trans>Requirements read from a posting</Trans>,
								unit: requirements,
							},
							{
								name: "actionTimeoutSeconds",
								label: <Trans>Time limit for Fit, Apply and other actions</Trans>,
								unit: seconds,
							},
						],
					},
					{
						legend: <Trans>Coach and Assistant replies</Trans>,
						description: (
							<Trans>
								A reply can call the model several times, with tools in between. One call never runs longer than the
								whole reply.
							</Trans>
						),
						limits: [
							{
								name: "replyTimeoutSeconds",
								label: <Trans>Time limit for a whole Coach or Assistant reply</Trans>,
								unit: seconds,
							},
							{
								name: "replyStepTimeoutSeconds",
								label: <Trans>Time limit for each model call in a reply</Trans>,
								unit: seconds,
							},
							{ name: "replySteps", label: <Trans>Model calls in one reply</Trans>, unit: calls },
							{ name: "replyOutputTokens", label: <Trans>Length of each model call's answer</Trans>, unit: tokens },
							{
								name: "replyContextTokens",
								label: <Trans>Conversation kept in view</Trans>,
								unit: tokens,
								blank: { placeholder: automatic, hint: t`Blank fits it to your model's context window.` },
							},
							{ name: "attachmentTextChars", label: <Trans>Text read from one attachment</Trans>, unit: characters },
							{
								name: "replyWebCalls",
								label: <Trans>Web searches and page reads in one reply</Trans>,
								unit: calls,
							},
						],
					},
					{
						legend: <Trans>Knowledge review</Trans>,
						description: <Trans>Review reads your switched-on facts in batches and looks for contradictions.</Trans>,
						limits: [
							{ name: "reviewBatches", label: <Trans>Batches in one review</Trans>, unit: t`batches` },
							{
								name: "reviewBatchChars",
								label: <Trans>Size of one batch</Trans>,
								unit: characters,
								blank: { placeholder: automatic, hint: t`Blank uses the facts and stories limits of the actions.` },
							},
						],
					},
					{
						legend: <Trans>Writing review</Trans>,
						limits: [
							{
								name: "reviewSuggestions",
								label: <Trans>Rewrite suggestions in one review</Trans>,
								unit: t`suggestions`,
							},
						],
					},
					{
						legend: <Trans>Voice</Trans>,
						limits: [
							{
								name: "transcriptionTimeoutSeconds",
								label: <Trans>Time limit for turning speech into text</Trans>,
								unit: seconds,
							},
							{ name: "speechTimeoutSeconds", label: <Trans>Time limit for reading text aloud</Trans>, unit: seconds },
							{ name: "recordingSeconds", label: <Trans>Longest recording</Trans>, unit: seconds },
						],
					},
					{
						legend: <Trans>All AI requests</Trans>,
						description: (
							<Trans>
								Applies to every request that has no limit of its own above: Writing review, Improve, reading PDF and
								Word files, and drafting letters.
							</Trans>
						),
						limits: [
							{
								name: "requestTimeoutSeconds",
								label: <Trans>Time limit for other AI requests</Trans>,
								unit: seconds,
							},
							{ name: "modelRetries", label: <Trans>Retries when the model fails</Trans>, unit: t`retries` },
							{
								name: "jsonOutputTokens",
								label: <Trans>Length of structured answers</Trans>,
								unit: tokens,
								blank: { placeholder: t`Provider default`, hint: t`Blank uses your provider's default.` },
							},
						],
					},
				]}
			/>
		</section>
	);
}

type AiLimitsFormProps = { groups: LimitGroup[] };

/**
 * Edits some of the AI limits. Each section owns only its own fields: a save sends the latest saved copy with this
 * section's fields replaced, so two sections never undo each other's changes.
 */
export function AiLimitsForm({ groups }: AiLimitsFormProps) {
	const query = useQuery(orpc.career.aiLimits.queryOptions());
	if (query.data) return <LimitsForm initial={query.data} groups={groups} />;
	if (query.isError)
		return (
			<div className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm text-ink-2 max-sm:px-4">
				<Trans>Couldn't load your AI limits.</Trans>
				<Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
					<Trans>Retry</Trans>
				</Button>
			</div>
		);
	return (
		<div className="flex justify-center px-5 py-6">
			<Spinner />
		</div>
	);
}

type LimitsFormProps = { initial: AiLimits; groups: LimitGroup[] };

function LimitsForm({ initial, groups }: LimitsFormProps) {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const queryKey = orpc.career.aiLimits.queryKey();
	const specs = groups.flatMap((group) => group.limits);
	const fields = specs.map((limit) => limit.name);
	const blankable = new Set(specs.filter((limit) => limit.blank).map((limit) => limit.name));
	/** What the user is typing, per field; an empty or partial number stays editable until it's valid. Blank is "". */
	const toDraft = (limits: AiLimits) =>
		Object.fromEntries(fields.map((field) => [field, String(limits[field] ?? "")])) as Partial<Record<Field, string>>;
	const [draft, setDraft] = useState(() => toDraft(initial));
	const [saved, setSaved] = useState(initial);
	const save = useMutation(
		orpc.career.saveAiLimits.mutationOptions({
			onSuccess: (limits) => {
				setSaved(limits);
				setDraft(toDraft(limits));
				queryClient.setQueryData(queryKey, limits);
				toast.add({ type: "success", description: t`AI limits saved.` });
			},
			onError: (error) =>
				toast.add({
					type: "error",
					description: getOrpcErrorMessage(error, { fallback: t`Couldn't save your AI limits.` }),
				}),
		}),
	);

	const value = (field: Field) => draft[field] ?? "";
	/** What a field saves as: its number, or null when a field that may be blank is left empty. */
	const parsed = (field: Field) => (value(field).trim() === "" && blankable.has(field) ? null : Number(value(field)));
	const invalid = (field: Field) => {
		const number = parsed(field);
		if (number === null) return false;
		const { min, max } = bounds(field);
		return value(field).trim() === "" || !Number.isInteger(number) || number < min || number > max;
	};
	const valid = fields.every((field) => !invalid(field));
	const dirty = fields.some((field) => parsed(field) !== saved[field]);
	const atDefaults = fields.every((field) => parsed(field) === DEFAULTS[field]);
	const number = new Intl.NumberFormat(i18n.locale);

	return (
		<form
			className="grid gap-5 px-5 py-4 max-sm:px-4"
			onSubmit={(event) => {
				event.preventDefault();
				if (!valid) return;
				const latest = queryClient.getQueryData<AiLimits>(queryKey) ?? saved;
				save.mutate({ ...latest, ...Object.fromEntries(fields.map((field) => [field, parsed(field)])) });
			}}
		>
			{groups.map((group, index) => (
				<fieldset key={index} className="grid gap-3">
					<legend className="mb-1 text-sm font-medium">{group.legend}</legend>
					{group.description && <p className="-mt-1 text-[13px] text-ink-3">{group.description}</p>}
					<div className="grid gap-3 sm:grid-cols-2">
						{group.limits.map(({ name, label, unit, blank }) => {
							const fallback = DEFAULTS[name];
							return (
								<LimitField
									key={name}
									name={name}
									label={label}
									unit={unit}
									value={value(name)}
									invalid={invalid(name)}
									placeholder={blank?.placeholder}
									hint={
										blank || fallback === null
											? `${blank?.hint ?? ""} ${t`From ${number.format(bounds(name).min)} to ${number.format(bounds(name).max)}.`}`.trim()
											: t`Default ${number.format(fallback)}. From ${number.format(bounds(name).min)} to ${number.format(bounds(name).max)}.`
									}
									onChange={(next) => setDraft((current) => ({ ...current, [name]: next }))}
								/>
							);
						})}
					</div>
				</fieldset>
			))}

			<div className="flex flex-wrap items-center justify-end gap-2">
				<Button
					type="button"
					variant="ghost"
					disabled={atDefaults || save.isPending}
					onClick={() => setDraft(toDraft(DEFAULTS))}
				>
					<Trans>Reset to defaults</Trans>
				</Button>
				<Button type="submit" disabled={!dirty || !valid || save.isPending} aria-busy={save.isPending}>
					{save.isPending ? <Spinner /> : <Trans>Save</Trans>}
				</Button>
			</div>
		</form>
	);
}

type LimitFieldProps = {
	name: Field;
	label: ReactNode;
	unit: string;
	value: string;
	invalid: boolean;
	/** Shown in an empty field that may be left blank. */
	placeholder?: string | undefined;
	hint: string;
	onChange: (value: string) => void;
};

function LimitField({ name, label, unit, value, invalid, placeholder, hint, onChange }: LimitFieldProps) {
	const id = useId();
	const { min, max } = bounds(name);

	return (
		<div className="grid content-start gap-1.5">
			<label htmlFor={id} className="text-xs font-medium text-ink-2">
				{label}
			</label>
			<div className="flex items-center gap-2">
				<Input
					id={id}
					type="number"
					inputMode="numeric"
					min={min}
					max={max}
					step={1}
					value={value}
					placeholder={placeholder}
					aria-invalid={invalid || undefined}
					aria-describedby={`${id}-hint`}
					onChange={(event) => onChange(event.target.value)}
					className="w-36"
				/>
				<span className="text-[13px] text-ink-3">{unit}</span>
			</div>
			<p id={`${id}-hint`} className={invalid ? "text-xs text-danger-text" : "text-xs text-ink-3"}>
				{hint}
			</p>
		</div>
	);
}
