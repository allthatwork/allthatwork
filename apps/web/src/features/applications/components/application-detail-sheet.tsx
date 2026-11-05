import type { Application } from "../types";
import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Plural, Trans } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@reactive-resume/ui/components/sheet";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { daysInStage } from "../next-step";
import { applicationsListQueryOptions } from "../queries";
import { getClosedReasonLabel, getNextStage, getStageColor, getStageLabel, PIPELINE } from "../stages";
import { foundBySuggestions, foundOnSuggestions } from "../suggestions";
import { useApplicationActions, useInvalidateApplications } from "../use-application-actions";
import { ApplicationNotes } from "./application-notes";
import { Activity } from "./detail/activity";
import { SearchSection, TargetingSection } from "./detail/assessments";
import { CloseDialog } from "./detail/close-dialog";
import { Contacts } from "./detail/contacts";
import { InlineFact } from "./detail/inline-fact";
import { NextStepCard } from "./detail/next-step-card";
import { SentDocuments } from "./detail/sent-documents";
import { InterviewDialog } from "./interview-dialog";
import { ViewPostingButton } from "./posting-dialog";
import { SuggestionCombobox } from "./suggestion-combobox";
import { useClosingValue } from "@/hooks/use-closing-value";
import { useConfirm } from "@/hooks/use-confirm";
import { orpc } from "@/libs/orpc/client";

type DetailSheetProps = {
	application: Application | null;
	onOpenChange: (open: boolean) => void;
	onEditDetails: (application: Application) => void;
};

/**
 * One application, 480px from the right (full screen on phones): the stage stepper with Move to next, the next
 * step, what was sent, the key facts, notes and activity. Close application… takes a reason; Delete is in ⋯.
 */
export function ApplicationDetailSheet({ application, onOpenChange, onEditDetails }: DetailSheetProps) {
	const phone = useBreakpoint() === "mobile";
	// Closing keeps the last application on screen until the sheet has slid away.
	const [shown, onOpenChangeComplete] = useClosingValue(application);
	const { data } = useQuery({
		...orpc.applications.getById.queryOptions({ input: { id: shown?.id ?? "" } }),
		// Fetch only while open; while closing, the cached copy keeps showing.
		enabled: Boolean(application),
		...(shown ? { placeholderData: shown } : {}),
	});
	const current = data ?? shown;

	return (
		<Sheet open={Boolean(application)} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
			<SheetContent
				side={phone ? "bottom" : "right"}
				closeLabel={t`Close`}
				className={cn("gap-0", phone ? "h-svh" : "data-[side=right]:sm:max-w-[480px]")}
			>
				{current && (
					<Detail
						key={current.id}
						application={current}
						targetingNotes={data?.targetingNotes}
						onEditDetails={onEditDetails}
						onDeleted={() => onOpenChange(false)}
					/>
				)}
			</SheetContent>
		</Sheet>
	);
}

type DetailProps = {
	application: Application;
	targetingNotes: string | null | undefined;
	onEditDetails: (application: Application) => void;
	onDeleted: () => void;
};

function Detail({ application, targetingNotes, onEditDetails, onDeleted }: DetailProps) {
	const { i18n } = useLingui();
	// The pick lists come from the values already used across all applications.
	const { data: applications = [] } = useQuery(applicationsListQueryOptions());
	const { data: profile } = useQuery(orpc.career.profile.queryOptions());
	const confirm = useConfirm();
	const { moveTo, close, remove } = useApplicationActions();
	const [interview, setInterview] = useState<{ open: boolean; entry: InterviewTimelineEntry | null }>({
		open: false,
		entry: null,
	});
	const [closing, setClosing] = useState(false);

	const next = getNextStage(application.status);
	const reached = PIPELINE.indexOf(application.status);
	const since = daysInStage(application);
	const closed = application.status === "closed";

	const onDelete = async () => {
		const confirmed = await confirm(t`Delete this application?`, {
			description: t`“${application.role} · ${application.company}” and its timeline are deleted permanently. This can't be undone.`,
			confirmText: t`Delete`,
		});
		if (!confirmed) return;
		remove.mutate({ id: application.id }, { onSuccess: onDeleted });
	};

	return (
		<>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<header className="grid gap-4 border-b border-line px-5 pt-5 pb-4">
					<div className="flex items-start gap-3 pe-8">
						<span
							aria-hidden="true"
							className="grid size-10 shrink-0 place-items-center rounded-[9px] bg-sunken font-semibold text-ink-2"
						>
							{application.company.slice(0, 1).toUpperCase()}
						</span>
						<div className="grid min-w-0 flex-1 gap-0.5">
							<SheetTitle className="font-display text-[22px] leading-7 font-medium">{application.role}</SheetTitle>
							<SheetDescription className="text-sm text-ink-2">
								{application.companyId ? (
									<Link
										to="/dashboard/directory"
										search={{ tab: "companies", company: application.companyId }}
										className="hover:underline"
									>
										{application.company}
									</Link>
								) : (
									application.company
								)}
								{application.location && ` · ${application.location}`}
							</SheetDescription>
							<ViewPostingButton application={application} size="sm" className="mt-1.5 w-fit" />
						</div>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button size="icon-sm" variant="ghost" aria-label={t`Application options`} className="text-ink-3" />
								}
							>
								<Icon name="dots-three" />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem onClick={() => onEditDetails(application)}>
									<Icon name="pencil-simple" size={18} />
									<Trans>Edit details…</Trans>
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem variant="destructive" onClick={onDelete}>
									<Icon name="trash" size={18} />
									<Trans>Delete…</Trans>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>

					<div className="grid gap-2.5">
						<ol aria-label={t`Stages`} className="grid grid-cols-5 gap-1.5">
							{PIPELINE.map((stage, index) => (
								<li key={stage}>
									<button
										type="button"
										aria-current={stage === application.status ? "step" : undefined}
										onClick={() => {
											if (stage !== application.status) moveTo(application, stage);
										}}
										className="grid w-full gap-1.5 text-start"
									>
										<span
											className="h-1.5 rounded-full transition-colors duration-standard"
											style={{
												background: !closed && index <= reached ? getStageColor(stage) : "var(--line)",
											}}
										/>
										<span
											className={cn(
												"truncate text-[11px]",
												stage === application.status ? "font-semibold text-ink" : "text-ink-3",
											)}
										>
											{getStageLabel(stage)}
										</span>
									</button>
								</li>
							))}
						</ol>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<span className="flex items-center gap-1.5 text-sm">
								<span
									aria-hidden="true"
									className="size-2 rounded-full"
									style={{ background: getStageColor(application.status) }}
								/>
								<strong className="font-semibold">{getStageLabel(application.status)}</strong>
								<span className="text-ink-3">
									{closed && application.closedReason ? (
										<>· {getClosedReasonLabel(application.closedReason)}</>
									) : (
										<>
											· <Plural value={since} _0="since today" one="for # day" other="for # days" />
										</>
									)}
								</span>
							</span>
							{next && !closed && (
								<Button size="sm" variant="secondary" onClick={() => moveTo(application, next)}>
									{application.status === "saved" ? (
										<Trans>Mark as applied</Trans>
									) : (
										<Trans>Move to {getStageLabel(next)}</Trans>
									)}
									<Icon name="arrow-right" size={16} />
								</Button>
							)}
						</div>
					</div>
				</header>

				<div className="grid gap-6 p-5">
					<NextStepCard
						application={application}
						onScheduleInterview={(entry) => setInterview({ open: true, entry })}
					/>
					<SentDocuments application={application} disabled={remove.isPending} />
					<Facts
						application={application}
						locale={i18n.locale}
						foundOn={foundOnSuggestions(applications)}
						foundBy={foundBySuggestions(applications)}
					/>
					<SearchSection application={application} locale={i18n.locale} />
					<TargetingSection
						application={application}
						targetingNotes={targetingNotes}
						lanes={profile?.lanes ?? []}
						locale={i18n.locale}
					/>
					<Tags application={application} />
					<ApplicationNotes application={application} />
					<Activity application={application} onOpenInterview={(entry) => setInterview({ open: true, entry })} />
				</div>
			</div>

			<footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface px-5 py-3">
				{!closed ? (
					<>
						<Button variant="secondary" onClick={() => setClosing(true)}>
							<Trans>Close application…</Trans>
						</Button>
						{application.sourceUrl && (
							<Button
								variant="ghost"
								nativeButton={false}
								className="text-ink-2"
								render={<a href={application.sourceUrl} target="_blank" rel="noreferrer" />}
							>
								<Trans>Posting</Trans>
								<Icon name="arrow-square-out" size={16} />
							</Button>
						)}
						<OpenWorkspaceButton application={application} />
					</>
				) : (
					<Button variant="secondary" onClick={() => moveTo(application, "applied")}>
						<Trans>Reopen</Trans>
					</Button>
				)}
			</footer>

			<CloseDialog open={closing} onOpenChange={setClosing} onClose={(reason) => close(application, reason)} />
			<InterviewDialog
				application={application}
				interview={interview.entry}
				open={interview.open}
				onOpenChange={(open) => setInterview((currentValue) => ({ ...currentValue, open }))}
			/>
		</>
	);
}

type FactsProps = { application: Application; locale: string; foundOn: string[]; foundBy: string[] };

/** Salary, Found on, Found by, Applied and Contact. All but Applied edit in place. */
function Facts({ application, locale, foundOn, foundBy }: FactsProps) {
	const invalidate = useInvalidateApplications();
	const update = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => invalidate(application.id),
		onError: () => toast.add({ type: "error", description: t`Couldn't save.` }),
	});
	const applied = new Date(application.appliedAt).toLocaleDateString(locale, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});

	return (
		<dl className="grid grid-cols-2 gap-x-4 gap-y-3">
			<InlineFact
				label={t`Salary`}
				value={application.salary}
				onSave={(salary) => update.mutate({ id: application.id, salary })}
			/>
			<ChoiceFact
				label={t`Found on`}
				value={application.source}
				suggestions={foundOn}
				onSave={(source) => update.mutate({ id: application.id, source })}
			/>
			<ChoiceFact
				label={t`Found by`}
				value={application.foundBy}
				suggestions={foundBy}
				onSave={(value) => update.mutate({ id: application.id, foundBy: value })}
			/>
			<div className="grid gap-0.5">
				<dt className="text-xs font-semibold text-ink-3 uppercase">
					<Trans>Applied</Trans>
				</dt>
				<dd className="text-sm font-medium">{application.status === "saved" ? "—" : applied}</dd>
			</div>
			<div className="col-span-2 grid gap-0.5">
				<dt className="text-xs font-semibold text-ink-3 uppercase">
					<Trans>Contact</Trans>
				</dt>
				<dd className="min-w-0">
					<Contacts
						contacts={application.contacts}
						disabled={update.isPending}
						onChange={(contacts) => update.mutate({ id: application.id, contacts })}
					/>
				</dd>
			</div>
		</dl>
	);
}

type ChoiceFactProps = {
	label: string;
	value: string | null;
	suggestions: readonly string[];
	onSave: (value: string | null) => void;
};

/** A fact picked from the values already in use, or typed new; the whole list shows when it opens. */
function ChoiceFact({ label, value, suggestions, onSave }: ChoiceFactProps) {
	const id = useId();
	return (
		<div className="grid min-w-0 gap-0.5">
			<dt className="text-xs font-semibold text-ink-3 uppercase">
				<label htmlFor={id}>{label}</label>
			</dt>
			<dd className="min-w-0">
				<SuggestionCombobox
					id={id}
					value={value}
					suggestions={suggestions}
					placeholder="—"
					onChange={(next) => {
						if (next !== value) onSave(next);
					}}
					render={
						<button
							type="button"
							className="w-full truncate rounded-md text-start text-sm font-medium hover:bg-hover"
						/>
					}
				/>
			</dd>
		</div>
	);
}

function Tags({ application }: { application: Application }) {
	const invalidate = useInvalidateApplications();
	const [tag, setTag] = useState("");
	const update = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => invalidate(application.id),
		onError: () => toast.add({ type: "error", description: t`Couldn't save the tags.` }),
	});
	const save = (tags: string[]) => update.mutate({ id: application.id, tags });

	return (
		<section aria-labelledby="application-tags" className="grid gap-2">
			<h3 id="application-tags" className="text-xs font-semibold text-ink-3 uppercase">
				<Trans>Tags</Trans>
			</h3>
			<div className="flex flex-wrap items-center gap-1.5">
				{application.tags.map((value) => (
					<span key={value} className="flex h-7 items-center gap-1 rounded-md bg-sunken ps-2 text-xs">
						{value}
						<button
							type="button"
							aria-label={t`Remove ${value}`}
							onClick={() => save(application.tags.filter((item) => item !== value))}
							className="grid size-6 place-items-center rounded text-ink-3 hover:text-ink"
						>
							<Icon name="x" size={14} />
						</button>
					</span>
				))}
				<form
					onSubmit={(event) => {
						event.preventDefault();
						const value = tag.trim();
						if (!value || application.tags.includes(value)) return setTag("");
						save([...application.tags, value]);
						setTag("");
					}}
				>
					<Input
						aria-label={t`Add a tag`}
						placeholder={t`Add a tag`}
						value={tag}
						className="h-7 w-28 text-xs"
						onChange={(event) => setTag(event.target.value)}
					/>
				</form>
			</div>
		</section>
	);
}

/** Opens the application's workspace on the tab for its stage. */
function OpenWorkspaceButton({ application }: { application: Application }) {
	const navigate = useNavigate();
	return (
		<Button
			className="ms-auto bg-accent-soft text-accent-text hover:bg-accent-soft hover:brightness-95"
			onClick={() =>
				void navigate({
					to: "/dashboard/applications/$applicationId/{-$tab}",
					params: { applicationId: application.id },
				})
			}
		>
			<Icon name="arrow-right" size={18} />
			<Trans>Open workspace</Trans>
		</Button>
	);
}
