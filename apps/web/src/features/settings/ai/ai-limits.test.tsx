// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { aiLimitsSchema } from "@reactive-resume/schema/career";

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
const toasts = vi.hoisted(() => ({ add: vi.fn() }));

vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		career: {
			aiLimits: {
				queryKey: () => ["ai-limits"],
				queryOptions: () => ({ queryKey: ["ai-limits"], queryFn: api.get }),
			},
			saveAiLimits: {
				mutationOptions: (options: object) => ({ mutationFn: api.save, ...options }),
			},
		},
	},
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: toasts.add, close: vi.fn() } }));
// The budget meter has its own test; here it would only add queries this file doesn't mock.
vi.mock("@/features/career/knowledge/budget", () => ({ BudgetMeter: () => null }));

i18n.loadAndActivate({ locale: "en", messages: {} });

const { AiLimitsForm, AiLimitsSection } = await import("./ai-limits");

const defaults = aiLimitsSchema.parse({});

function renderSection() {
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<AiLimitsSection />
			</QueryClientProvider>
		</I18nProvider>,
	);
}

describe("AI limits", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		api.get.mockResolvedValue(defaults);
		api.save.mockImplementation(async (limits: unknown) => limits);
	});

	it("saves every limit after one is raised", async () => {
		renderSection();
		const facts = await screen.findByLabelText("Facts shared with each message");
		const save = screen.getByRole("button", { name: "Save" });
		expect(save.hasAttribute("disabled")).toBe(true);

		fireEvent.change(facts, { target: { value: "200" } });
		fireEvent.click(save);

		await waitFor(() => expect(api.save).toHaveBeenCalled());
		expect(api.save.mock.calls[0]?.[0]).toEqual({ ...defaults, coachFacts: 200 });
		await waitFor(() => expect(toasts.add).toHaveBeenCalledWith(expect.objectContaining({ type: "success" })));
	});

	it("lists the application action limits in order, and saves a raised targeting note", async () => {
		renderSection();
		const targeting = await screen.findByLabelText("Targeting note in each action");
		const group = targeting.closest("fieldset");
		const labels = Array.from(group?.querySelectorAll("label") ?? [], (label) => label.textContent);
		expect(labels).toEqual([
			"Facts in each action",
			"Stories in each action",
			"Posting in each action",
			"Requirements in each action",
			"Your notes in each action",
			"Job search notes in each action",
			"Targeting note in each action",
			"Contacts in each action",
			"Resume in each action",
			"Cover letter in each action",
			"Story chosen in Practise",
			"Requirements Fit scores",
			"Requirements read from a posting",
			"Time limit for Fit, Apply and other actions",
		]);
		expect(group?.textContent).toContain("Default 6,000. From 500 to 1,000,000.");
		expect(screen.getByLabelText("Requirements Fit scores").closest("div")?.textContent).toContain("requirements");

		fireEvent.change(targeting, { target: { value: "120000" } });
		fireEvent.change(screen.getByLabelText("Requirements Fit scores"), { target: { value: "101" } });
		expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
		fireEvent.change(screen.getByLabelText("Requirements Fit scores"), { target: { value: "100" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(api.save.mock.calls[0]?.[0]).toEqual({
				...defaults,
				actionTargetingNotesChars: 120_000,
				fitRequirements: 100,
			}),
		);
	});

	it("won't save a limit outside its range, and Reset puts the defaults back", async () => {
		api.get.mockResolvedValue({ ...defaults, actionFactChars: 50_000 });
		renderSection();
		const budget = await screen.findByLabelText("Facts in each action");
		expect((budget as HTMLInputElement).value).toBe("50000");

		fireEvent.change(budget, { target: { value: "500" } });
		expect(budget.getAttribute("aria-invalid")).toBe("true");
		expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);

		fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
		expect((budget as HTMLInputElement).value).toBe("10000");
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(api.save.mock.calls[0]?.[0]).toEqual(defaults));
	});

	it("saves a longer time limit for application actions and replies", async () => {
		renderSection();
		fireEvent.change(await screen.findByLabelText("Time limit for Fit, Apply and other actions"), {
			target: { value: "600" },
		});
		fireEvent.change(screen.getByLabelText("Time limit for a whole Coach or Assistant reply"), {
			target: { value: "720" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(api.save.mock.calls[0]?.[0]).toEqual({ ...defaults, actionTimeoutSeconds: 600, replyTimeoutSeconds: 720 }),
		);
	});

	it("shows the groups in order, with the Coach, reply, review, voice and request limits", async () => {
		renderSection();
		await screen.findByLabelText("Conversation kept in view");
		const legends = Array.from(document.querySelectorAll("legend"), (legend) => legend.textContent);
		expect(legends).toEqual([
			"Coach",
			"Application actions",
			"Coach and Assistant replies",
			"Knowledge review",
			"Writing review",
			"Voice",
			"All AI requests",
		]);
		const labelsOf = (name: string) =>
			Array.from(
				screen.getByLabelText(name).closest("fieldset")?.querySelectorAll("label") ?? [],
				(label) => label.textContent,
			);
		expect(labelsOf("Applications the Coach can list").slice(-2)).toEqual([
			"Applications the Coach can list",
			"Interview debriefs the Coach can read",
		]);
		expect(labelsOf("Model calls in one reply")).toEqual([
			"Time limit for a whole Coach or Assistant reply",
			"Time limit for each model call in a reply",
			"Model calls in one reply",
			"Length of each model call's answer",
			"Conversation kept in view",
			"Text read from one attachment",
			"Web searches and page reads in one reply",
		]);
		expect(labelsOf("Batches in one review")).toEqual(["Batches in one review", "Size of one batch"]);
		expect(labelsOf("Rewrite suggestions in one review")).toEqual(["Rewrite suggestions in one review"]);
		expect(labelsOf("Longest recording").at(-1)).toBe("Longest recording");
		expect(labelsOf("Retries when the model fails")).toEqual([
			"Time limit for other AI requests",
			"Retries when the model fails",
			"Length of structured answers",
		]);
		const context = screen.getByLabelText("Conversation kept in view") as HTMLInputElement;
		expect(context.value).toBe("");
		expect(context.placeholder).toBe("Automatic");
		expect(context.closest("div.grid")?.textContent).toContain(
			"Blank fits it to your model's context window. From 10,000 to 2,000,000.",
		);
		expect((screen.getByLabelText("Length of structured answers") as HTMLInputElement).placeholder).toBe(
			"Provider default",
		);
		expect(screen.getByLabelText("Applications the Coach can list").closest("div.grid")?.textContent).toContain(
			"Default 50. From 10 to 500.",
		);
	});

	it("saves a blank field as null and a number in it as that number, and Reset empties it", async () => {
		api.get.mockResolvedValue({ ...defaults, replyContextTokens: 150_000, coachApplications: 200 });
		renderSection();
		const context = (await screen.findByLabelText("Conversation kept in view")) as HTMLInputElement;
		expect(context.value).toBe("150000");

		fireEvent.change(context, { target: { value: "" } });
		expect(context.getAttribute("aria-invalid")).toBeNull();
		fireEvent.change(screen.getByLabelText("Size of one batch"), { target: { value: "30000" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(api.save.mock.calls[0]?.[0]).toEqual({
				...defaults,
				coachApplications: 200,
				replyContextTokens: null,
				reviewBatchChars: 30_000,
			}),
		);
		await waitFor(() => expect(toasts.add).toHaveBeenCalledWith(expect.objectContaining({ type: "success" })));

		fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
		expect((screen.getByLabelText("Size of one batch") as HTMLInputElement).value).toBe("");
		expect((screen.getByLabelText("Applications the Coach can list") as HTMLInputElement).value).toBe("50");
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(api.save.mock.calls[1]?.[0]).toEqual(defaults));
	});

	it("still refuses a blank value in a field that needs a number", async () => {
		renderSection();
		const steps = await screen.findByLabelText("Model calls in one reply");
		fireEvent.change(steps, { target: { value: "" } });
		expect(steps.getAttribute("aria-invalid")).toBe("true");
		expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
		fireEvent.change(steps, { target: { value: "60" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(api.save.mock.calls[0]?.[0]).toEqual({ ...defaults, replySteps: 60 }));
	});

	it("saves only its own limits from another section, keeping the rest as last saved", async () => {
		api.get.mockResolvedValue({ ...defaults, coachFacts: 99 });
		render(
			<I18nProvider i18n={i18n}>
				<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
					<AiLimitsForm
						groups={[
							{ legend: "Time limits", limits: [{ name: "webCallTimeoutSeconds", label: "Web call", unit: "s" }] },
						]}
					/>
				</QueryClientProvider>
			</I18nProvider>,
		);
		fireEvent.change(await screen.findByLabelText("Web call"), { target: { value: "45" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(api.save.mock.calls[0]?.[0]).toEqual({ ...defaults, coachFacts: 99, webCallTimeoutSeconds: 45 }),
		);
	});
});
