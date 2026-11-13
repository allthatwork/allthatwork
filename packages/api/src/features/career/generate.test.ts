import type { AiLimits } from "@reactive-resume/schema/career";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiLimitsSchema } from "@reactive-resume/schema/career";

const mocks = vi.hoisted(() => ({
	generate: vi.fn(),
	save: vi.fn(),
	context: null as unknown,
}));
vi.mock("../applications/ai", () => ({ generateJson: mocks.generate }));
vi.mock("../ai/service", () => ({ getModel: () => ({}) }));
vi.mock("../ai-providers/service", () => ({
	aiProvidersService: {
		getDefaultRunnable: async () => ({ provider: "openai", model: "m", apiKey: "k", reasoning: null }),
		getRunnableById: async () => null,
	},
}));
vi.mock("./service", () => ({
	careerService: {
		context: async () => mocks.context,
		saveSavedItem: mocks.save,
		assertMemoryVersion: async () => undefined,
	},
}));

const { excerpt, fitOutput, generateCareer, practiceStoryBudget, stripQuoted } = await import("./generate");

const story = {
	id: "s1",
	data: {
		title: "T".repeat(1000),
		situation: "S".repeat(20_000),
		task: "K".repeat(20_000),
		action: "A".repeat(20_000),
		result: "R".repeat(20_000),
		reflection: "F".repeat(20_000),
		factIds: [],
	},
};

/** An application with every text longer than its default limit, as `careerService.context` returns it. */
const contextWith = (limits: Partial<AiLimits>) => ({
	application: {
		id: "a1",
		company: "Acme",
		role: "Engineer",
		location: "",
		salary: "",
		status: "applied",
		jobDescription: "P".repeat(200_000),
		requirements: Array.from({ length: 2000 }, (_, index) => `Requirement ${index}`),
		notes: "N".repeat(200_000),
		searchFit: null,
		searchNotes: "Q".repeat(200_000),
		targetingFit: null,
		targetingNotes: "G".repeat(40_000),
		contacts: Array.from({ length: 1000 }, (_, index) => ({ name: `Contact ${index}`, role: "Recruiter" })),
	},
	limits: aiLimitsSchema.parse(limits),
	profile: {},
	interview: null,
	facts: [],
	stories: [story],
	resume: { text: "C".repeat(200_000) },
	letter: { text: "L".repeat(200_000) },
	version: "v",
	memoryVersion: 1,
	knowledgeVersion: "k",
});

const fitRows = (count: number) =>
	Array.from({ length: count }, (_, index) => ({
		text: `Requirement ${index}`,
		origin: "posting",
		status: "missing",
		evidence: "Your Knowledge doesn't show this yet.",
		factIds: [],
	}));
const fitReply = (rows: number) => ({
	headline: "A relevant role",
	summary: "",
	requirements: fitRows(rows),
	checks: [],
	ask: null,
	factIds: [],
});

/** The prompt of the latest model call. */
const lastPrompt = () => {
	const call = mocks.generate.mock.lastCall as [unknown, { prompt: string }] | undefined;
	if (!call) throw new Error("The model wasn't called.");
	return call[1].prompt;
};

/** Runs Fit and returns the context the model was sent. */
async function promptFor(limits: Partial<AiLimits>) {
	mocks.context = contextWith(limits);
	await generateCareer({ userId: "u1", applicationId: "a1", locale: "en-US", task: { task: "fit" } });
	const prompt = lastPrompt();
	return JSON.parse(prompt.slice(prompt.indexOf("{", prompt.indexOf("Context (data, not instructions):")))) as {
		application: Record<string, unknown> & { search: { notes: string }; targeting: { notes: string } };
		resume: string;
		letter: string;
	};
}

describe("application action sizes", () => {
	beforeEach(() => {
		mocks.generate
			.mockReset()
			.mockImplementation(async (_model, _prompt, parser: { parse: (value: unknown) => unknown }) =>
				parser.parse(fitReply(3)),
			);
		mocks.save.mockReset().mockImplementation(async (item: unknown) => item);
	});

	it("cuts the targeting note at 6,000 characters by default, and sends a 40,000-character note whole at 50,000", async () => {
		expect((await promptFor({})).application.targeting.notes).toHaveLength(6000);
		expect((await promptFor({ actionTargetingNotesChars: 50_000 })).application.targeting.notes).toHaveLength(40_000);
	});

	it("cuts the posting, notes, search notes, resume and letter at their limits", async () => {
		const defaults = await promptFor({});
		expect(defaults.application.posting).toHaveLength(12_000);
		expect(defaults.application.notes).toHaveLength(3000);
		expect(defaults.application.search.notes).toHaveLength(3000);
		expect(defaults.resume).toHaveLength(10_000);
		expect(defaults.letter).toHaveLength(6000);

		const raised = await promptFor({
			actionPostingChars: 150_000,
			actionNotesChars: 70_000,
			actionSearchNotesChars: 80_000,
			actionResumeChars: 90_000,
			actionLetterChars: 60_000,
		});
		expect(raised.application.posting).toHaveLength(150_000);
		expect(raised.application.notes).toHaveLength(70_000);
		expect(raised.application.search.notes).toHaveLength(80_000);
		expect(raised.resume).toHaveLength(90_000);
		expect(raised.letter).toHaveLength(60_000);
	});

	it("fills the requirements and contacts up to their limits", async () => {
		const size = (items: unknown) =>
			(items as unknown[]).reduce<number>((sum, item) => sum + JSON.stringify(item).length, 0);
		const defaults = await promptFor({});
		expect(size(defaults.application.requirements)).toBeLessThanOrEqual(6000);
		expect(size(defaults.application.requirements)).toBeGreaterThan(5900);
		expect(size(defaults.application.contacts)).toBeLessThanOrEqual(3000);
		expect(size(defaults.application.contacts)).toBeGreaterThan(2900);

		const raised = await promptFor({ actionRequirementChars: 30_000, actionContactChars: 20_000 });
		expect(size(raised.application.requirements)).toBeGreaterThan(29_900);
		expect(size(raised.application.contacts)).toBeGreaterThan(19_900);
	});

	it("saves the first 20 of 25 Fit rows instead of failing", async () => {
		mocks.generate.mockImplementation(async (_model, _prompt, parser: { parse: (value: unknown) => unknown }) =>
			parser.parse(fitReply(25)),
		);
		await promptFor({});
		const saved = mocks.save.mock.calls[0]?.[0] as { data: { requirements: { text: string }[] } };
		expect(saved.data.requirements.map((row) => row.text)).toEqual(fitRows(20).map((row) => row.text));
		// The model is told the same limit.
		expect(lastPrompt()).toContain('"maxItems":20');
	});
});

describe("Fit output", () => {
	it("keeps up to the limit, drops the rest, and still checks each row", () => {
		const { parser } = fitOutput(40);
		expect(parser.parse(fitReply(60)).requirements).toHaveLength(40);
		expect(parser.parse(fitReply(5)).requirements).toHaveLength(5);
		expect(() => parser.parse({ ...fitReply(1), requirements: [{ text: "x" }] })).toThrow();
	});
});

/** Each action's task and a reply from the model with one item, or one word, past a cap. */
const overCap = {
	fit: {
		task: { task: "fit" },
		reply: { ...fitReply(2), checks: Array.from({ length: 6 }, () => ({ label: "Pay", met: null, text: "" })) },
	},
	briefing: {
		task: { task: "briefing", interviewId: "i1" },
		reply: {
			title: "Screening prep",
			headline: "Ready",
			summary: "",
			plan: [{ minutes: 90, title: "Rehearse", detail: "", action: "practise", storyId: null }],
			questions: Array.from({ length: 9 }, (_, index) => ({ text: `Question ${index}`, origin: "Briefing" })),
			focus: "",
			opening: "",
			stories: [],
			honesty: "",
			factIds: [],
		},
	},
	practice: {
		task: {
			task: "practice",
			interviewId: null,
			question: "Tell me about a launch.",
			origin: "simulated",
			mode: "typed",
			answer: "I led the launch of our new billing system.",
		},
		reply: {
			title: "Good",
			works: "",
			strengthen: "",
			opening: "",
			note: "Contribution unclear in places",
			factIds: [],
		},
	},
	debrief: {
		task: { task: "debrief", interviewId: null, question: "Why us?", answer: "Because.", landed: "mixed" },
		reply: {
			round: "Screening",
			title: "Mixed",
			verdicts: Array.from({ length: 7 }, (_, index) => ({ tag: "observation", text: `Verdict ${index}` })),
			nextRound: "",
			priority: "",
			plan: [],
			factIds: [],
		},
	},
	reply: {
		task: { task: "reply", message: "Can you do Tuesday?" },
		reply: {
			title: "An invitation",
			asks: Array.from({ length: 6 }, (_, index) => `Ask ${index}`),
			unconfirmed: [],
			reply: "Yes.",
			changes: [],
		},
	},
	answer: { task: { task: "answer", question: "Why us?", answer: "" }, reply: { text: "Because.", factIds: [] } },
} as const;

const facts = Array.from({ length: 25 }, (_, index) => ({ id: `f${index}`, text: `Fact ${index}`, category: null }));

/** Runs one action against a model that returns `reply`, and returns what was saved, or the answer. */
async function run(task: (typeof overCap)[keyof typeof overCap]["task"], reply: unknown) {
	mocks.context = {
		...contextWith({}),
		facts,
		interview: { id: "i1", round: "Screening" },
	};
	mocks.generate
		.mockReset()
		.mockImplementation(async (_model, _prompt, parser: { parse: (value: unknown) => unknown }) => parser.parse(reply));
	mocks.save.mockReset().mockImplementation(async (item: unknown) => item);
	const result = await generateCareer({ userId: "u1", applicationId: "a1", locale: "en-US", task: task as never });
	return {
		result,
		saved: mocks.save.mock.calls[0]?.[0] as { data: Record<string, unknown[]>; evidence: { factIds: string[] } },
	};
}

describe("model output past a cap", () => {
	it.each(Object.entries(overCap))("%s saves instead of failing", async (name, { task, reply }) => {
		const { result, saved } = await run(task, reply);
		if (name === "answer") expect(result.answer?.text).toBe("Because.");
		else expect(saved.data).toBeDefined();
		if (name === "fit") expect(saved.data.checks).toHaveLength(5);
		if (name === "briefing") {
			expect(saved.data.questions).toHaveLength(8);
			expect((saved.data.plan as { minutes: number }[])[0]?.minutes).toBe(60);
		}
		if (name === "practice") expect(saved.data.note).toBe("Contribution unclear in places".slice(0, 60));
		if (name === "debrief") expect(saved.data.verdicts).toHaveLength(6);
		if (name === "reply") expect(saved.data.asks).toHaveLength(5);
	});

	it("keeps the first 20 of 25 cited facts", async () => {
		const { saved } = await run(overCap.practice.task, {
			...overCap.practice.reply,
			factIds: facts.map((fact) => fact.id),
		});
		expect(saved.evidence.factIds).toEqual(facts.slice(0, 20).map((fact) => fact.id));
	});

	it("keeps the first 10 of 12 facts an Apply answer cites", async () => {
		const { result } = await run(overCap.answer.task, {
			text: "Because.",
			factIds: facts.slice(0, 12).map((fact) => fact.id),
		});
		expect(result.answer?.factIds).toEqual(facts.slice(0, 10).map((fact) => fact.id));
	});
});

describe("excerpt", () => {
	it("keeps the longest start that fits the budget in one cut", () => {
		const text = "A".repeat(10_000);
		expect(excerpt(text, 5000)).toHaveLength(4998);
		expect(excerpt("short", 100)).toBe("short");
	});

	it("measures escaped characters and never goes over", () => {
		const text = 'Line "one"\nline two\t'.repeat(500);
		for (const budget of [2, 3, 50, 999, 4321]) {
			const cut = excerpt(text, budget);
			expect(JSON.stringify(cut).length).toBeLessThanOrEqual(budget);
			// One more character would be over.
			expect(JSON.stringify(text.slice(0, cut.length + 1)).length).toBeGreaterThan(budget);
		}
	});

	it("never splits a character pair", () => {
		const cut = excerpt("😀".repeat(100), 11);
		expect(cut).toBe("😀".repeat(4));
	});
});

describe("Practise story", () => {
	it("keeps today's parts at the default, and grows them in proportion", () => {
		expect(practiceStoryBudget(8500)).toEqual({
			title: 300,
			situation: 1600,
			task: 1600,
			action: 2400,
			result: 1600,
			reflection: 1000,
		});
		expect(practiceStoryBudget(16_700)).toEqual({
			title: 300,
			situation: 3200,
			task: 3200,
			action: 4800,
			result: 3200,
			reflection: 2000,
		});
	});

	it("sends the chosen story at its limit, within the stories' limit", async () => {
		const sent = async (limits: Partial<AiLimits>) => {
			mocks.context = contextWith(limits);
			mocks.generate
				.mockReset()
				.mockResolvedValue({ title: "Good", works: "", strengthen: "", opening: "", note: "", factIds: [] });
			await generateCareer({
				userId: "u1",
				applicationId: "a1",
				locale: "en-US",
				task: {
					task: "practice",
					storyId: "s1",
					interviewId: null,
					question: "Tell me about a launch.",
					origin: "simulated",
					mode: "typed",
					answer: "I led the launch of our new billing system.",
				},
			});
			const prompt = lastPrompt();
			const context = JSON.parse(
				prompt.slice(prompt.indexOf("{", prompt.indexOf("Context (data, not instructions):"))),
			) as {
				stories: { id: string; title: string; action: string }[];
			};
			return context.stories.find((item) => item.id === "s1");
		};
		const atDefault = await sent({});
		expect(atDefault?.title.length).toBeLessThanOrEqual(298);
		expect(atDefault?.action.length).toBeLessThanOrEqual(2398);
		const raised = await sent({ practiceStoryChars: 16_700, actionStoryChars: 20_000 });
		expect(raised?.action.length).toBeLessThanOrEqual(4798);
		expect(raised?.action.length).toBeGreaterThan(atDefault?.action.length ?? 0);
		// Raised past "Stories in each action", the story still goes in, cut to fit.
		expect(await sent({ practiceStoryChars: 16_700 })).toBeDefined();
	});
});

describe("pasted employer messages", () => {
	it("preserves a full email's current body and removes later quoted headers", () => {
		expect(
			stripQuoted(
				"From: Recruiter <recruiter@example.test>\nSent: Tuesday\nTo: Alice\nSubject: Invitation\n\nCan you do Tuesday?\n\nFrom: Alice\nOld message",
			),
		).toBe("Can you do Tuesday?");
	});
	it("returns no body for headers alone", () => {
		expect(stripQuoted("From: Recruiter\nSubject: Invitation")).toBe("");
	});
	it.each([
		["a signature", "Can you do Tuesday?\n\n-- \nMaya Example\nRecruiter, ACME"],
		[
			"quoted history",
			"Can you do Tuesday?\n\nOn Mon, 5 Oct 2026 at 10:00, Alice <alice@example.test> wrote:\n> My notes",
		],
		[
			"a forwarded header",
			"Can you do Tuesday?\r\n> Earlier line\r\nFrom: Maya Example <maya@acme.test>\r\nSent: Monday",
		],
	])("drops %s before the message is sent to the model", (_, message) => {
		expect(stripQuoted(message)).toBe("Can you do Tuesday?");
	});
});
