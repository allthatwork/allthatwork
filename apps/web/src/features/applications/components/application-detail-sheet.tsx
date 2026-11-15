import type { ApplicationLane } from "../lanes";
import type { Application, ApplicationSummary } from "../types";
import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Plural, Trans } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import { applicationSentAt } from "@reactive-resume/schema/applications/outcomes";
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
import { getCategoryLane, getDisplayLane, getLaneLabel, getNextLane, getStageDisplay } from "../lanes";
import { daysInLane } from "../next-step";
import { applicationDetailQueryOptions, applicationsListQueryOptions, getInitialApplicationDetail } from "../queries";
import { getClosedReasonLabel } from "../stages";
import { foundBySuggestions, foundOnSuggestions } from "../suggestions";
import { useApplicationActions, useInvalidateApplications } from "../use-application-actions";
import { useApplicationLanes } from "../use-application-lanes";
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
	application: ApplicationSummary | null;
	returnFocus: (id: string) => HTMLElement | null;
	onOpenChange: (open: boolean) => void;
	onEditDetails: (application: Application) => void;
};

/**
 * One application, 480px from the right (full screen on phones): the stage stepper with Move to next, the next
 * step, what was sent, the key facts, notes and activity. Close application… takes a reason; Delete is in ⋯.
 */
export function ApplicationDetailSheet({ application, onOpenChange, onEditDetails, returnFocus }: DetailSheetProps) {
	const contentRef = useRef<HTMLDivElement>(null);
	const phone = useBreakpoint() === "mobile";
	// Closing keeps the last application on screen until the sheet has slid away.
	const [shown, onOpenChangeComplete] = useClosingValue(application);
	const initialDetail = getInitialApplicationDetail(shown);
	const { data, isError, isFetching, isPending, refetch } = useQuery({
		...applicationDetailQueryOptions(shown?.id ?? ""),
		// Fetch only while open; while closing, the cached copy keeps showing.
		enabled: Boolean(application),
		initialData: initialDetail,
		initialDataUpdatedAt: 0,
	});
	const current = data;

	return (
		<Sheet open={Boolean(application)} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
			<SheetContent
				ref={contentRef}
				initialFocus={() =>
					contentRef.current?.querySelector<HTMLElement>(
						current ? '[data-slot="sheet-title"]' : '[data-slot="sheet-close"]',
					) ?? false
				}
				finalFocus={() => (shown ? returnFocus(shown.id) : null) ?? false}
				side={phone ? "bottom" : "right"}
				closeLabel={t`Close`}
				className={cn("gap-0", phone ? "h-svh" : "data-[side=right]:sm:max-w-[480px]")}
			>
				{current ? (
					<Detail
						key={current.id}
						application={current}
						targetingNotes={data?.targetingNotes}
						onEditDetails={onEditDetails}
						onDeleted={() => onOpenChange(false)}
					/>
				) : (
					<div className="grid gap-2 p-5">
						<SheetTitle tabIndex={-1} dir="auto">
							{shown?.role}
						</SheetTitle>
						<SheetDescription aria-live="polite">
							{isError ? t`Couldn't load this. Your saved data hasn't changed.` : t`Loading…`}
						</SheetDescription>
						{isError && (
							<Button variant="secondary" disabled={isFetching || isPending} onClick={() => void refetch()}>
								<Trans>Try again</Trans>
							</Button>
						)}
					</div>
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
	const { moveTo, close, remove, logFollowUp } = useApplicationActions();
	const { lanes, active } = useApplicationLanes();
	const [interview, setInterview] = useState<{ open: boolean; entry: InterviewTimelineEntry | null }>({
		open: false,
		entry: null,
	});
	const [closing, setClosing] = useState(false);

	const current = getDisplayLane(lanes, application);
	const steps = active.filter((lane) => lane.category !== "closed");
	const next = getNextLane(lanes, current);
	const stage = getStageDisplay(lanes, application);
	const closed = application.status === "closed";
	// An accepted offer keeps its pipeline filled through Offer: it was won, not lost.
	const reached = stage.accepted
		? steps.findLastIndex((lane) => lane.category === "offer")
		: steps.findIndex((lane) => lane.id === current.id);
	const since = daysInLane(application);
	// One click everywhere, Mark as applied included: a move out of Saved saves the written answers on the server and
	// records the submission.
	const goTo = (lane: ApplicationLane) => {
		if (lane.id === current.id) return;
		// Moving to Interview usually means one is being set up: once the move is saved, offer to schedule it, unless
		// one already is.
		const scheduled = application.activity.some(
			(entry) => entry.type === "interview" && new Date(entry.at).getTime() > Date.now(),
		);
		moveTo(
			application,
			lane,
			undefined,
			lane.category === "interview" && !scheduled
				? () =>
						toast.add({
							description: t`Moved to ${getLaneLabel(lane)}.`,
							actionProps: {
								children: t`Schedule it`,
								onClick: () => setInterview({ open: true, entry: null }),
							},
						})
				: undefined,
		);
	};

	const onDelete = async () => {
		const confirmed = await confirm(t`Move to Trash`, {
			description: t`Applications and their timelines can be restored from Trash.`,
			confirmText: t`Move to Trash`,
			cancelText: t`Keep application`,
			variant: "danger",
		});
		if (!confirmed) return;
		remove.mutate({ id: application.id }, { onSuccess: onDeleted });
	};

	return (
		<>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<header className="sticky top-0 z-10 grid gap-4 border-b border-line bg-raised px-5 pt-5 pb-4 [@media(max-height:500px)]:static">
					<div className="flex items-start gap-3 pe-8">
						<span
							aria-hidden="true"
							className="grid size-10 shrink-0 place-items-center rounded-lg bg-sunken font-semibold text-ink-2"
						>
							{application.company.slice(0, 1).toUpperCase()}
						</span>
						<div className="grid min-w-0 flex-1 gap-0.5">
							<SheetTitle tabIndex={-1} dir="auto" className="font-display text-[22px] leading-7">
								{application.role}
							</SheetTitle>
							<SheetDescription className="text-sm text-ink-2">
								{application.companyId ? (
									<Link
										to="/dashboard/directory"
										search={{ tab: "companies", company: application.companyId }}
										className="hover:underline"
									>
										<bdi>{application.company}</bdi>
									</Link>
								) : (
									<bdi>{application.company}</bdi>
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
									<Trans>Move to Trash</Trans>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>

					<div className="grid gap-2.5">
						{/* Equal columns while they fit (five by default); more lanes scroll sideways. */}
						<ol
							aria-label={t`Stages`}
							className="-mx-1 grid auto-cols-[minmax(64px,1fr)] grid-flow-col gap-1.5 overflow-x-auto px-1 pb-1"
						>
							{steps.map((lane, index) => {
								const label = getLaneLabel(lane);
								return (
									<li key={lane.id} className="min-w-0">
										<button
											type="button"
											title={label}
											aria-current={lane.id === current.id ? "step" : undefined}
											onClick={() => goTo(lane)}
											className="grid w-full gap-1.5 text-start"
										>
											<span
												className="h-1.5 rounded-sm transition-colors duration-standard"
												style={{
													background: (!closed || stage.accepted) && index <= reached ? lane.color : "var(--line)",
												}}
											/>
											<span
												className={cn(
													"truncate text-xs",
													lane.id === current.id ? "font-semibold text-ink" : "text-ink-3",
												)}
											>
												{label}
											</span>
										</button>
									</li>
								);
							})}
						</ol>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<span className="flex min-w-0 items-center gap-1.5 text-sm">
								<span aria-hidden="true" className="size-2 shrink-0 rounded-sm" style={{ background: stage.color }} />
								{stage.accepted && <Icon name="check" size={16} className="shrink-0 text-accent-text" />}
								<strong className="truncate font-semibold">{stage.label}</strong>
								<span className="shrink-0 text-ink-3">
									{stage.accepted ? null : closed && application.closedReason ? (
										<>· {getClosedReasonLabel(application.closedReason)}</>
									) : since === null ? null : (
										<>
											· <Plural value={since} _0="since today" one="for # day" other="for # days" />
										</>
									)}
								</span>
							</span>
							{next && !closed && (
								<Button size="sm" variant="secondary" onClick={() => goTo(next)}>
									{application.status === "saved" && next.category === "applied" ? (
										<Trans>Mark as applied</Trans>
									) : (
										<Trans>Move to {getLaneLabel(next)}</Trans>
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
					{!closed && application.status !== "saved" && (
						<Button
							variant="secondary"
							disabled={logFollowUp.isPending}
							onClick={() => logFollowUp.mutate({ id: application.id })}
						>
							<Trans>Followed up</Trans>
						</Button>
					)}
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
							<Trans>Mark as closed…</Trans>
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
					<Button variant="secondary" onClick={() => moveTo(application, getCategoryLane(lanes, "applied"))}>
						<Trans>Reopen</Trans>
					</Button>
				)}
			</footer>

			<CloseDialog
				open={closing}
				status={application.status}
				onOpenChange={setClosing}
				lanes={active}
				onClose={(lane, reason) => (lane ? moveTo(application, lane, reason) : reason && close(application, reason))}
			/>
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
		onError: () => toast.add({ type: "error", description: t`Couldn't save the change. Try again.` }),
	});
	const applied = applicationSentAt(application)
		? new Date(application.appliedAt).toLocaleDateString(locale, {
				month: "short",
				day: "numeric",
				year: "numeric",
			})
		: t`Not recorded`;

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
				<dt className="text-xs font-semibold text-ink-3">
					<Trans>Applied</Trans>
				</dt>
				<dd className="text-sm font-medium">{application.status === "saved" ? "—" : applied}</dd>
			</div>
			<div className="col-span-2 grid gap-0.5">
				<dt className="text-xs font-semibold text-ink-3">
					<Trans>Contact</Trans>
				</dt>
				<dd className="min-w-0">
					<Contacts
						application={application}
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
			<dt className="text-xs font-semibold text-ink-3">
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
		onError: () => toast.add({ type: "error", description: t`Couldn't save the tags. Try again.` }),
	});
	const save = (tags: string[]) => update.mutate({ id: application.id, tags });

	return (
		<section aria-labelledby="application-tags" className="grid gap-2">
			<h3 id="application-tags" className="text-xs font-semibold text-ink-3">
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
