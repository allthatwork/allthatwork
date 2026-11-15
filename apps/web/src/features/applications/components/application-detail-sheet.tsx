import type { ApplicationLane } from "../lanes";
import type { Application, ApplicationSummary } from "../types";
import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Plural, Trans } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
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
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@reactive-resume/ui/components/sheet";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { isInterview, interviewKindOf } from "../interviews";
import { getCategoryLane, getDisplayLane, getLaneLabel, getNextLane, getStageDisplay, laneDotColor } from "../lanes";
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
import { NextStepCard } from "./detail/next-step-card";
import { SentDocuments } from "./detail/sent-documents";
import { factLabelClassName, factRowClassName, SheetSection, TextButton } from "./detail/sheet-parts";
import { InterviewDialog } from "./interview-dialog";
import { ViewPostingButton } from "./posting-dialog";
import { SuggestionCombobox } from "./suggestion-combobox";
import { Chip } from "@/components/calm/filter-bar";
import { IconTile, List, ListRow } from "@/components/calm/list-row";
import { StageStepper } from "@/components/calm/stage-stepper";
import { midSentence, useCareerTime, useNow } from "@/features/career/shared";
import { useClosingValue } from "@/hooks/use-closing-value";
import { isImeComposing } from "@/libs/keyboard";
import { orpc } from "@/libs/orpc/client";

type DetailSheetProps = {
	application: ApplicationSummary | null;
	returnFocus: (id: string) => HTMLElement | null;
	onOpenChange: (open: boolean) => void;
	onEditDetails: (application: Application) => void;
};

/**
 * One application, 480px from the right (full screen on phones), opened from its row or card: the stage and the date
 * each was reached, with Move to next (one click, Mark as applied included) and Mark as closed…; the next interview;
 * what was sent; the job's facts, the search and targeting assessments, contacts, notes and timeline. Every value edits
 * in place, and Edit interview takes the sheet's place rather than opening on top of it. Move to Trash is in ⋯, and
 * Open workspace leads to the application's own page.
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
				showCloseButton={false}
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
					<>
						<SheetHeading title={shown?.role} />
						<div className="grid gap-2 px-6 pb-5">
							<SheetDescription aria-live="polite">
								{isError ? t`Couldn't load this. Your saved data hasn't changed.` : t`Loading…`}
							</SheetDescription>
							{isError && (
								<Button variant="secondary" disabled={isFetching || isPending} onClick={() => void refetch()}>
									<Trans>Try again</Trans>
								</Button>
							)}
						</div>
					</>
				)}
			</SheetContent>
		</Sheet>
	);
}

/** The sheet's header (`.hd`): its title and one quiet line, then ⋯ and Close. */
function SheetHeading({ title, description, menu }: { title: ReactNode; description?: ReactNode; menu?: ReactNode }) {
	return (
		<header className="flex shrink-0 items-center gap-2 ps-6 pe-4 pt-5 pb-3">
			<div className="flex min-w-0 flex-1 flex-col">
				<SheetTitle tabIndex={-1} dir="auto" className="truncate outline-none">
					{title}
				</SheetTitle>
				{description && (
					<SheetDescription dir="auto" className="truncate text-[13px]/[18px] text-ink-3">
						{description}
					</SheetDescription>
				)}
			</div>
			{menu}
			<SheetClose render={<Button variant="ghost" size="icon" aria-label={t`Close`} className="text-ink-2" />}>
				<Icon name="x" size={20} />
			</SheetClose>
		</header>
	);
}

type DetailProps = {
	application: Application;
	targetingNotes: string | null | undefined;
	onEditDetails: (application: Application) => void;
	onDeleted: () => void;
};

function Detail({ application, targetingNotes, onEditDetails, onDeleted }: DetailProps) {
	const time = useCareerTime();
	const now = useNow();
	const { i18n } = useLingui();
	// The pick lists come from the values already used across all applications.
	const { data: applications = [] } = useQuery(applicationsListQueryOptions());
	const { data: profile } = useQuery(orpc.career.profile.queryOptions());
	const { moveTo, close, remove, logFollowUp } = useApplicationActions();
	const { lanes, active } = useApplicationLanes();
	const [interview, setInterview] = useState<{ open: boolean; entry: InterviewTimelineEntry | null }>({
		open: false,
		entry: null,
	});
	// Where focus goes back to when the interview form gives the sheet back.
	const opener = useRef<HTMLElement | null>(null);
	const [closing, setClosing] = useState(false);

	const current = getDisplayLane(lanes, application);
	const steps = active.filter((lane) => lane.category !== "closed");
	const next = getNextLane(lanes, current);
	const stage = getStageDisplay(lanes, application);
	const closed = application.status === "closed";
	// An accepted offer keeps its pipeline filled through Offer: it was won, not lost.
	const reached = stage.accepted ? steps.findLast((lane) => lane.category === "offer")?.id : current.id;
	const since = daysInLane(application);
	const upcoming = application.activity
		.filter(isInterview)
		.filter((entry) => +new Date(entry.at) >= +now)
		.toSorted((a, b) => +new Date(a.at) - +new Date(b.at))[0];
	const openInterview = (entry: InterviewTimelineEntry | null) => {
		opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		setInterview({ open: true, entry });
	};
	// When each stage was reached: its own lane's move, else the latest move into its stage.
	const reachedOn = (lane: ApplicationLane) => {
		const moves = application.activity.filter((event) => event.type === "stage" && !event.dateUnknown);
		const entry =
			moves.findLast((event) => event.type === "stage" && event.laneId === lane.id) ??
			moves.findLast((event) => event.type === "stage" && event.stage === lane.category);
		if (!entry) return undefined;
		return lane.id === current.id && !closed ? t`since ${time.date(entry.at)}` : time.date(entry.at);
	};
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
								onClick: () => openInterview(null),
							},
						})
				: undefined,
		);
	};

	const onDelete = () => remove.mutate({ id: application.id }, { onSuccess: onDeleted });

	return (
		<>
			<div hidden={interview.open} className="flex min-h-0 flex-1 flex-col">
				<SheetHeading
					title={application.role}
					description={
						<>
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
						</>
					}
					menu={
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button size="icon" variant="ghost" aria-label={t`Application options`} className="text-ink-2" />
								}
							>
								<Icon name="dots-three" size={20} />
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
					}
				/>
				{/* No sticky footer: the sheet scrolls and fades at its edge. */}
				<div className="relative min-h-0 flex-1">
					<div className="h-full overflow-y-auto px-6 pb-10">
						<div className="flex flex-wrap items-center gap-2 pb-4">
							<ViewPostingButton application={application} size="sm" />
							<OpenWorkspaceButton application={application} />
						</div>
						<div className="flex flex-wrap items-center gap-1 pb-2">
							<h3 className="me-auto text-sm/5 font-semibold">
								<Trans>Stage</Trans>
							</h3>
							{closed ? (
								<Button
									size="sm"
									variant="secondary"
									onClick={() => moveTo(application, getCategoryLane(lanes, "applied"))}
								>
									<Trans>Reopen</Trans>
								</Button>
							) : (
								<>
									{next && (
										<Button size="sm" variant="secondary" onClick={() => goTo(next)}>
											{application.status === "saved" && next.category === "applied" ? (
												<Trans>Mark as applied</Trans>
											) : (
												<Trans>Move to {getLaneLabel(next)}</Trans>
											)}
											<Icon name="arrow-right" size={16} />
										</Button>
									)}
									<Button size="sm" variant="ghost" onClick={() => setClosing(true)}>
										<Trans>Mark as closed…</Trans>
									</Button>
								</>
							)}
						</div>
						{/* Equal columns while they fit (five by default); more lanes scroll sideways. */}
						<StageStepper
							aria-label={t`Stage history`}
							variant="history"
							current={(!closed || stage.accepted) && reached ? reached : ""}
							steps={steps.map((lane) => ({
								id: lane.id,
								status: lane.category,
								label: getLaneLabel(lane),
								date: reachedOn(lane),
								color: laneDotColor(lane),
							}))}
							onSelect={(step) => {
								const lane = steps.find((item) => item.id === step.id);
								if (lane) goTo(lane);
							}}
							className="auto-cols-[minmax(64px,1fr)] overflow-x-auto"
						/>
						{closed && (
							<p className="flex min-w-0 items-center gap-1.5 pt-3 text-sm">
								<span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: stage.color }} />
								{stage.accepted && <Icon name="check" size={16} className="shrink-0 text-accent-text" />}
								<strong className="truncate font-semibold">{stage.label}</strong>
								<span className="shrink-0 text-ink-3">
									{stage.accepted ? null : application.closedReason ? (
										<>· {getClosedReasonLabel(application.closedReason)}</>
									) : since === null ? null : (
										<>
											· <Plural value={since} _0="since today" one="for # day" other="for # days" />
										</>
									)}
								</span>
							</p>
						)}

						{upcoming ? (
							<List cap className="mt-3.5">
								<ListRow
									className="min-h-[46px] py-1.5 sm:min-h-[46px]"
									title={
										<span className="block truncate text-sm/5">
											{t`${interviewKindOf(upcoming.kind)?.label ?? ""} interview`}
										</span>
									}
									subtitle={[
										time.when(upcoming.at),
										`${upcoming.durationMinutes} ${t`min`}`,
										midSentence(upcoming.location),
									]
										.filter(Boolean)
										.join(" · ")}
									leading={
										<IconTile className="size-8 rounded-sm">
											<Icon name="calendar-dot" size={18} />
										</IconTile>
									}
									trailing={
										<TextButton className="text-sm/5" onClick={() => openInterview(upcoming)}>
											<Trans>Edit interview</Trans>
										</TextButton>
									}
								/>
							</List>
						) : (
							<div className="pt-3.5">
								<NextStepCard application={application} onScheduleInterview={openInterview} />
							</div>
						)}

						<div className="pt-5">
							<SentDocuments application={application} disabled={remove.isPending} />
						</div>

						<SheetSection>
							<Trans>About the job</Trans>
						</SheetSection>
						<Facts
							application={application}
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

						<ContactSection application={application} />

						<ApplicationNotes
							application={application}
							renderLabel={(label, htmlFor) => (
								<SheetSection
									note={<Trans>The coach reads these for this application only</Trans>}
									render={(className, content) => (
										<label htmlFor={htmlFor} className={className}>
											{content}
										</label>
									)}
								>
									{label}
								</SheetSection>
							)}
						/>

						<Activity
							dateColumnWhenLogging
							application={application}
							onOpenInterview={openInterview}
							logActions={
								!closed &&
								application.status !== "saved" && (
									<TextButton
										className="text-xs"
										disabled={logFollowUp.isPending}
										onClick={() => logFollowUp.mutate({ id: application.id })}
									>
										<Trans>Followed up</Trans>
									</TextButton>
								)
							}
							renderHeader={(log) => (
								<SheetSection
									id="application-activity"
									action={
										<TextButton aria-expanded={log.open} onClick={log.toggle}>
											<Trans>Log an update</Trans>
										</TextButton>
									}
								>
									<Trans>Timeline</Trans>
								</SheetSection>
							)}
						/>

						{upcoming && (
							<details className="pt-5">
								<summary className="cursor-pointer text-[13px] text-ink-2">
									<Trans>Next step and follow-up</Trans>
								</summary>
								<div className="pt-2">
									<NextStepCard application={application} onScheduleInterview={openInterview} />
								</div>
							</details>
						)}
					</div>
					<div
						aria-hidden="true"
						className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-b from-transparent to-raised"
					/>
				</div>
			</div>

			<InterviewDialog
				inline
				application={application}
				interview={interview.entry}
				open={interview.open}
				onOpenChange={(open) => {
					setInterview((currentValue) => ({ ...currentValue, open }));
					if (!open) requestAnimationFrame(() => opener.current?.focus());
				}}
			/>
			<CloseDialog
				open={closing}
				status={application.status}
				company={application.company}
				role={application.role}
				onOpenChange={setClosing}
				lanes={active}
				onClose={(lane, reason) => (lane ? moveTo(application, lane, reason) : reason && close(application, reason))}
			/>
		</>
	);
}

/** Contacts, then anyone met at an interview who isn't one yet. */
function ContactSection({ application }: { application: Application }) {
	const invalidate = useInvalidateApplications();
	const update = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => invalidate(application.id),
		onError: () => toast.add({ type: "error", description: t`Couldn't save the change. Try again.` }),
	});
	const people = application.activity
		.filter(isInterview)
		.flatMap((entry) => entry.participants)
		.filter(
			(person, index, all) =>
				!application.contacts.some((contact) => contact.name === person.name) &&
				all.findIndex((item) => item.name === person.name) === index,
		);

	return (
		<Contacts
			inline
			application={application}
			disabled={update.isPending}
			onChange={(contacts) => update.mutate({ id: application.id, contacts })}
			people={people}
			renderHeader={(add) => (
				<SheetSection
					action={
						<TextButton disabled={add.disabled} onClick={add.start}>
							<Trans>Add contact</Trans>
						</TextButton>
					}
				>
					<Trans>Contacts</Trans>
				</SheetSection>
			)}
		/>
	);
}

type FactsProps = { application: Application; foundOn: string[]; foundBy: string[] };

/** Posting, Found on, Found by, Salary and Tags (`.kv`). All but the posting edit in place. */
function Facts({ application, foundOn, foundBy }: FactsProps) {
	const invalidate = useInvalidateApplications();
	const update = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => invalidate(application.id),
		onError: () => toast.add({ type: "error", description: t`Couldn't save the change. Try again.` }),
	});

	return (
		<dl className="grid">
			{application.sourceUrl && (
				<div className={factRowClassName}>
					<dt className={factLabelClassName}>
						<Trans>Posting</Trans>
					</dt>
					<dd className="flex min-w-0 items-center gap-2">
						<a
							href={application.sourceUrl}
							title={application.sourceUrl}
							dir="ltr"
							target="_blank"
							rel="noreferrer"
							className="flex min-w-0 items-center gap-2 font-mono text-[13px]/4 font-medium hover:underline"
						>
							<span className="truncate">{application.sourceUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
							<Icon name="arrow-square-out" size={16} className="shrink-0 text-ink-3" />
						</a>
					</dd>
				</div>
			)}
			<ChoiceFact
				label={t`Found on`}
				value={application.source}
				empty={t`Not recorded`}
				suggestions={foundOn}
				onSave={(source) => update.mutate({ id: application.id, source })}
			/>
			<ChoiceFact
				label={t`Found by`}
				value={application.foundBy}
				empty={t`Not recorded`}
				suggestions={foundBy}
				onSave={(value) => update.mutate({ id: application.id, foundBy: value })}
			/>
			<InlineFact
				label={t`Salary`}
				value={application.salary}
				empty={t`Not listed in the posting`}
				onSave={(salary) => update.mutate({ id: application.id, salary })}
			/>
			<Tags application={application} />
		</dl>
	);
}

type ChoiceFactProps = {
	label: string;
	value: string | null;
	empty: string;
	suggestions: readonly string[];
	onSave: (value: string | null) => void;
};

/** A fact picked from the values already in use, or typed new; the whole list shows when it opens. */
function ChoiceFact({ label, value, empty, suggestions, onSave }: ChoiceFactProps) {
	const id = useId();
	return (
		<div className={factRowClassName}>
			<dt className={factLabelClassName}>
				<label htmlFor={id} className="block leading-5">
					{label}
				</label>
			</dt>
			<dd className="min-w-0">
				<SuggestionCombobox
					id={id}
					value={value}
					suggestions={suggestions}
					placeholder={empty}
					onChange={(next) => {
						if (next !== value) onSave(next);
					}}
					render={
						<button
							type="button"
							className={cn(
								"block w-full cursor-text truncate rounded-xs text-start hover:underline",
								!value && "text-ink-3",
							)}
						/>
					}
				/>
			</dd>
		</div>
	);
}

type InlineFactProps = { label: string; value: string | null; empty: string; onSave: (value: string | null) => void };

/** A fact that edits in place: click to type, Enter or leaving saves, Esc cancels. */
function InlineFact({ label, value, empty, onSave }: InlineFactProps) {
	const id = useId();
	const [draft, setDraft] = useState<string | null>(null);

	const commit = () => {
		if (draft === null) return;
		const next = draft.trim() || null;
		if (next !== (value ?? null)) onSave(next);
		setDraft(null);
	};

	return (
		<div className={factRowClassName}>
			<dt className={factLabelClassName}>
				<label htmlFor={id} className="block leading-5">
					{label}
				</label>
			</dt>
			<dd className="min-w-0">
				{draft === null ? (
					<button
						id={id}
						type="button"
						onClick={() => setDraft(value ?? "")}
						dir="auto"
						className={cn(
							"block w-full cursor-text truncate rounded-xs text-start hover:underline",
							!value && "text-ink-3",
						)}
					>
						{value || empty}
					</button>
				) : (
					<Input
						id={id}
						autoFocus
						value={draft}
						placeholder={empty}
						className="h-8"
						onChange={(event) => setDraft(event.target.value)}
						onBlur={commit}
						onKeyDown={(event) => {
							if (isImeComposing(event)) return;
							if (event.key === "Enter") commit();
							if (event.key === "Escape") {
								event.stopPropagation();
								setDraft(null);
							}
						}}
					/>
				)}
			</dd>
		</div>
	);
}

/** Tags as chips, each with its remove button, and "Add a tag" that turns into a field. */
function Tags({ application }: { application: Application }) {
	const invalidate = useInvalidateApplications();
	const [tag, setTag] = useState<string | null>(null);
	const update = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => invalidate(application.id),
		onError: () => toast.add({ type: "error", description: t`Couldn't save the tags. Try again.` }),
	});
	const save = (tags: string[]) => update.mutate({ id: application.id, tags });
	const commit = () => {
		const value = tag?.trim();
		if (value && !application.tags.includes(value)) save([...application.tags, value]);
		setTag(null);
	};

	return (
		<div className={cn(factRowClassName, "py-1")}>
			<dt className={factLabelClassName}>
				<Trans>Tags</Trans>
			</dt>
			<dd className="flex min-w-0 flex-wrap items-center gap-1.5">
				{application.tags.map((value) => (
					<Chip
						key={value}
						className="group h-6 text-xs/[18px] [&_button]:hidden focus-within:[&_button]:inline-flex hover:[&_button]:inline-flex"
						removeLabel={t`Remove ${value}`}
						onRemove={() => save(application.tags.filter((item) => item !== value))}
					>
						{value}
					</Chip>
				))}
				{tag === null ? (
					<Chip variant="dash" className="h-6 text-xs/[18px]" onClick={() => setTag("")}>
						<Icon name="plus" size={16} />
						<Trans>Add a tag</Trans>
					</Chip>
				) : (
					<Input
						aria-label={t`Add a tag`}
						placeholder={t`Add a tag`}
						autoFocus
						value={tag}
						className="h-6 w-32 px-2 text-xs"
						onChange={(event) => setTag(event.target.value)}
						onBlur={commit}
						onKeyDown={(event) => {
							if (isImeComposing(event)) return;
							if (event.key === "Enter") {
								event.preventDefault();
								commit();
							}
							if (event.key === "Escape") {
								event.stopPropagation();
								setTag(null);
							}
						}}
					/>
				)}
			</dd>
		</div>
	);
}

/** Opens the application's workspace on the tab for its stage. */
function OpenWorkspaceButton({ application }: { application: Application }) {
	const navigate = useNavigate();
	return (
		<Button
			size="sm"
			className="bg-accent-soft text-accent-text hover:bg-accent-soft hover:brightness-95"
			onClick={() =>
				void navigate({
					to: "/dashboard/applications/$applicationId/{-$tab}",
					params: { applicationId: application.id },
				})
			}
		>
			<Icon name="arrow-right" size={16} />
			<Trans>Open workspace</Trans>
		</Button>
	);
}
