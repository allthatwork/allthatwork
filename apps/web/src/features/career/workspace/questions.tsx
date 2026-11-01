import type { WorkspaceTabProps } from "./shell";
import type { TargetingQuestion } from "@reactive-resume/schema/applications/data";
import type { FactCategory } from "@reactive-resume/schema/career";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { useInvalidateApplications } from "@/features/applications/use-application-actions";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

/** The kind of fact an answer makes, from the Knowledge group it goes into. */
const categoryFor = (group: string | null): FactCategory =>
	group && /achievement|accomplishment/i.test(group)
		? "accomplishment"
		: group && /expertise|skill/i.test(group)
			? "skill"
			: "experience";

/**
 * What targeting the resume couldn't find in Knowledge, as questions to answer: each one fills in a proposed fact and
 * saves it to its Knowledge group, so the next build reads it and stops asking. Answered and set-aside questions
 * collect under Done and can be reopened.
 */
export function QuestionsTab({ application, version }: WorkspaceTabProps) {
	const questions = application.targetingQuestions;
	const open = questions.filter((question) => question.status === "open");
	const done = questions.filter((question) => question.status !== "open");
	const readOnly = version !== undefined;
	// Open questions with the same topic on the user's other applications: answering here closes those too.
	const { data: all = [] } = useQuery(applicationsListQueryOptions());
	const sharedCount = (topic: string | null) =>
		topic
			? all.filter(
					(other) =>
						other.id !== application.id &&
						other.targetingQuestions.some((item) => item.topic === topic && item.status === "open"),
				).length
			: 0;

	if (questions.length === 0)
		return (
			<div className="grid justify-items-center gap-3 rounded-xl border border-dashed border-line-2 p-7 text-center">
				<h2 className="font-display text-[22px] leading-7 font-medium">
					<Trans>No questions for you</Trans>
				</h2>
				<p className="max-w-[440px] text-sm text-ink-2">
					<Trans>
						When a resume is targeted at this job, what it looked for and couldn't find in your Knowledge shows up here
						as questions. Each answer is saved to Knowledge, so the next resume can use it.
					</Trans>
				</p>
			</div>
		);

	return (
		<div className="grid max-w-[760px] gap-6">
			<header className="grid gap-1">
				<h2 className="font-display text-[22px] leading-7 font-medium">
					{open.length > 0 ? (
						<Plural value={open.length} one="# question for you" other="# questions for you" />
					) : (
						<Trans>All questions answered</Trans>
					)}
				</h2>
				<p className="text-sm text-ink-2">
					<Trans>
						Evidence targeting looked for and couldn't find in your Knowledge. Answer in your own words and save it to
						Knowledge. A gap means it isn't recorded yet, not that you can't do it.
					</Trans>
				</p>
			</header>

			{open.map((question, index) => (
				<QuestionCard
					key={question.id}
					applicationId={application.id}
					question={question}
					number={index + 1}
					readOnly={readOnly}
					shared={sharedCount(question.topic)}
				/>
			))}

			{done.length > 0 && (
				<section aria-labelledby="questions-done" className="grid gap-2.5">
					<h3 id="questions-done" className="text-xs font-semibold text-ink-3 uppercase">
						<Trans>Done</Trans> · {done.length}
					</h3>
					{done.map((question) => (
						<DoneQuestion key={question.id} applicationId={application.id} question={question} readOnly={readOnly} />
					))}
				</section>
			)}
		</div>
	);
}

function useQuestionActions(applicationId: string) {
	const queryClient = useQueryClient();
	const invalidate = useInvalidateApplications();
	const saveFact = useMutation(orpc.career.saveFact.mutationOptions());
	const updateQuestion = useMutation({
		...orpc.applications.updateQuestion.mutationOptions(),
		onSuccess: () => invalidate(applicationId),
	});

	/** Saves the text as a shared Knowledge fact in the question's group, then marks the question with it. */
	const saveAnswer = async (question: TargetingQuestion, text: string, status: "answered" | "dismissed") => {
		const fact = await saveFact.mutateAsync({
			applicationId: null,
			category: status === "dismissed" ? "skill" : categoryFor(question.factGroup),
			text,
			group: question.factGroup,
			source: { kind: "manual", id: `targeting-question:${applicationId}:${question.id}`, quote: text },
		});
		if (!fact) throw new Error("not saved");
		void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
		await updateQuestion.mutateAsync({
			id: applicationId,
			questionId: question.id,
			status,
			answer: text,
			factId: fact.id,
		});
	};

	const setStatus = (question: TargetingQuestion, status: "open" | "dismissed", answer?: string) =>
		updateQuestion.mutateAsync({ id: applicationId, questionId: question.id, status, answer: answer ?? null });

	return { saveAnswer, setStatus, saving: saveFact.isPending || updateQuestion.isPending };
}

type QuestionCardProps = {
	applicationId: string;
	question: TargetingQuestion;
	number: number;
	readOnly: boolean;
	/** How many other applications ask this same question (same topic). */
	shared: number;
};

function QuestionCard({ applicationId, question, number, readOnly, shared }: QuestionCardProps) {
	const id = useId();
	const { saveAnswer, setStatus, saving } = useQuestionActions(applicationId);
	const [text, setText] = useState("");
	const [declining, setDeclining] = useState(false);
	const [no, setNo] = useState("");

	const fail = (error: unknown) =>
		toast.add({
			type: "error",
			description: getOrpcErrorMessage(error, { fallback: t`Couldn't save that to Knowledge.` }),
		});

	const answer = () => {
		if (!text.trim()) return;
		saveAnswer(question, text.trim(), "answered").catch(fail);
	};

	const decline = (record: boolean) => {
		const note = no.trim();
		(record && note
			? saveAnswer(question, note, "dismissed")
			: setStatus(question, "dismissed", note || undefined)
		).catch(fail);
	};

	return (
		<article aria-labelledby={`${id}-question`} className="grid gap-3.5 rounded-xl border border-line bg-surface p-4">
			<div className="flex gap-3">
				<span className="grid size-6 shrink-0 place-items-center rounded-full bg-sunken text-xs font-semibold text-ink-2">
					{number}
				</span>
				<div className="grid gap-1">
					<p id={`${id}-question`} className="text-sm leading-[21px] font-medium">
						{question.question}
					</p>
					{shared > 0 && (
						<p className="text-xs text-ink-3">
							<Plural
								value={shared}
								one="Also asked on # other application. Answering here answers it there too."
								other="Also asked on # other applications. Answering here answers them too."
							/>
						</p>
					)}
				</div>
			</div>

			<div className="grid gap-1.5">
				<label htmlFor={`${id}-answer`} className="text-xs font-semibold text-ink-3 uppercase">
					<Trans>Your answer</Trans>
				</label>
				<Textarea
					id={`${id}-answer`}
					rows={3}
					value={text}
					disabled={readOnly}
					placeholder={t`What happened, in your own words. It's saved to Knowledge as written.`}
					onChange={(event) => setText(event.target.value)}
					className="text-sm"
				/>
				{question.proposedFact && (
					<p className="text-xs leading-[18px] text-ink-3">
						<span className="font-semibold">
							<Trans>Suggested wording:</Trans>
						</span>{" "}
						{question.proposedFact}
						{!readOnly && (
							<>
								{" "}
								<button
									type="button"
									className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink"
									onClick={() => setText(question.proposedFact)}
								>
									<Trans>Use this</Trans>
								</button>
							</>
						)}
					</p>
				)}
				{question.boundary && (
					<p className="text-xs leading-[18px] text-ink-3">
						<span className="font-semibold">
							<Trans>Keep it within the record:</Trans>
						</span>{" "}
						{question.boundary}
					</p>
				)}
				<p className="text-xs text-ink-3">
					{question.factGroup ? (
						<Trans>
							Goes to Knowledge · <span className="font-medium text-ink-2">{question.factGroup}</span>
						</Trans>
					) : (
						<Trans>Goes to Knowledge</Trans>
					)}
				</p>
			</div>

			{!readOnly &&
				(declining ? (
					<div className="grid gap-2 rounded-lg border border-line p-3">
						<label htmlFor={`${id}-no`} className="text-xs text-ink-3">
							<Trans>
								Anything to remember instead? Saved to Knowledge so later resumes don't ask again (optional).
							</Trans>
						</label>
						<Input
							id={`${id}-no`}
							value={no}
							placeholder={t`For example: No hands-on Go; read and reviewed Go code only.`}
							onChange={(event) => setNo(event.target.value)}
							className="h-8 text-sm"
						/>
						<div className="flex flex-wrap gap-1.5">
							{no.trim() && (
								<Button size="sm" variant="secondary" loading={saving} onClick={() => decline(true)}>
									<Trans>Save and set aside</Trans>
								</Button>
							)}
							<Button size="sm" variant="ghost" disabled={saving} onClick={() => decline(false)}>
								<Trans>Set aside without saving</Trans>
							</Button>
							<Button size="sm" variant="ghost" onClick={() => setDeclining(false)}>
								<Trans>Cancel</Trans>
							</Button>
						</div>
					</div>
				) : (
					<div className="flex flex-wrap items-center gap-1.5">
						<Button size="sm" loading={saving} disabled={!text.trim()} onClick={answer}>
							<Icon name="check" size={16} />
							<Trans>Save to Knowledge</Trans>
						</Button>
						<Button size="sm" variant="ghost" onClick={() => setDeclining(true)}>
							<Trans>I don't have this</Trans>
						</Button>
					</div>
				))}
		</article>
	);
}

type DoneQuestionProps = { applicationId: string; question: TargetingQuestion; readOnly: boolean };

function DoneQuestion({ applicationId, question, readOnly }: DoneQuestionProps) {
	const { setStatus, saving } = useQuestionActions(applicationId);
	const answered = question.status === "answered";
	return (
		<div className="grid gap-1.5 rounded-lg border border-line px-3.5 py-3">
			<div className="flex items-start justify-between gap-3">
				<p className="text-[13px] leading-[19px] text-ink-2">{question.question}</p>
				{!readOnly && (
					<Button
						size="sm"
						variant="ghost"
						className="shrink-0"
						disabled={saving}
						onClick={() =>
							setStatus(question, "open").catch((error: unknown) =>
								toast.add({
									type: "error",
									description: getOrpcErrorMessage(error, { fallback: t`Couldn't reopen it.` }),
								}),
							)
						}
					>
						<Trans>Reopen</Trans>
					</Button>
				)}
			</div>
			<p className={cn("flex gap-1.5 text-[13px] leading-[19px]", answered ? "text-ink" : "text-ink-3")}>
				<Icon name={answered ? "check" : "minus"} size={16} className="mt-0.5 shrink-0" />
				<span>
					{answered ? (
						question.answer
					) : question.answer ? (
						<Trans>Set aside: {question.answer}</Trans>
					) : (
						<Trans>Set aside</Trans>
					)}
					{question.answeredOn && (
						<span className="text-ink-3">
							{" "}
							· <Trans>answered on {question.answeredOn.company}</Trans>
						</span>
					)}
					{question.factId && (
						<span className="text-ink-3">
							{" "}
							· <Trans>in Knowledge</Trans>
						</span>
					)}
				</span>
			</p>
		</div>
	);
}
