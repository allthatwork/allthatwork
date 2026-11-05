// @vitest-environment happy-dom
import type { Application } from "../types";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({ update: vi.fn(), current: null as unknown }));
vi.mock("@/libs/orpc/client", () => {
	const endpoint = (name: string, mutation = vi.fn()) => ({
		key: () => [name],
		queryKey: (options?: unknown) => [name, options],
		queryOptions: (options?: unknown) => ({
			queryKey: [name, options],
			queryFn: async () => (name === "getById" ? api.current : name === "list" ? [] : null),
		}),
		mutationOptions: () => ({ mutationFn: mutation }),
	});
	return {
		orpc: {
			applications: {
				getById: endpoint("getById"),
				list: endpoint("list"),
				stats: endpoint("stats"),
				tags: endpoint("tags"),
				update: endpoint("update", api.update),
				delete: endpoint("delete"),
			},
			career: { profile: endpoint("profile"), savedItems: endpoint("savedItems") },
			documents: { list: endpoint("documents") },
		},
	};
});
// The sections below the header have their own tests; this one is about the stage controls.
vi.mock("./detail/activity", () => ({ Activity: () => null }));
vi.mock("./detail/assessments", () => ({ SearchSection: () => null, TargetingSection: () => null }));
vi.mock("./detail/next-step-card", () => ({ NextStepCard: () => null }));
vi.mock("./detail/sent-documents", () => ({ SentDocuments: () => null }));
vi.mock("./detail/contacts", () => ({ Contacts: () => null }));
vi.mock("./application-notes", () => ({ ApplicationNotes: () => null }));
vi.mock("./interview-dialog", () => ({ InterviewDialog: () => null }));
vi.mock("./posting-dialog", () => ({ ViewPostingButton: () => null }));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@reactive-resume/ui/hooks/use-breakpoint", () => ({ useBreakpoint: () => "desktop" }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => <a href="#test-link">{children}</a>,
	useNavigate: () => vi.fn(),
}));

import { ApplicationDetailSheet } from "./application-detail-sheet";

const saved: Application = {
	id: "saved-application",
	company: "Harbor",
	companyId: null,
	role: "Engineer",
	status: "saved",
	closedReason: null,
	coverLetterId: null,
	sentResumeVersionId: null,
	sentCoverLetterVersionId: null,
	sentCheckScore: null,
	requirements: [],
	location: null,
	salary: null,
	source: null,
	sourceUrl: null,
	notes: null,
	tags: [],
	contacts: [],
	activity: [],
	appliedAt: new Date("2026-10-08T12:00:00Z"),
	createdAt: new Date("2026-10-08T12:00:00Z"),
	updatedAt: new Date("2026-10-08T12:00:00Z"),
	resumeId: "resume-1",
	jobDescription: null,
	postingSource: null,
	matchScore: null,
	aiMetadata: null,
	resumeFileUrl: "https://files.example/resume.pdf",
	resumeFileName: "resume.pdf",
	coverLetterUrl: null,
	coverLetterName: null,
	followUpAt: null,
	followUpNote: null,
	foundBy: null,
	searchFit: null,
	searchNotes: null,
	searchAt: null,
	targetingBuildStatus: null,
	targetingNotes: null,
	targetingFit: null,
	targetingReviews: [],
	targetingPrimaryLane: null,
	targetingSecondaryLane: null,
	targetingAt: null,
	targetingQuestions: [],
};

const clients: QueryClient[] = [];
const mount = (application: Application) => {
	api.current = application;
	const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
	clients.push(client);
	vi.spyOn(client, "invalidateQueries");
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>{children}</I18nProvider>
		</QueryClientProvider>
	);
	return render(<ApplicationDetailSheet application={application} onOpenChange={vi.fn()} onEditDetails={vi.fn()} />, {
		wrapper,
	});
};
beforeEach(() => {
	vi.clearAllMocks();
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	api.update.mockResolvedValue(undefined);
});
afterEach(() => {
	cleanup();
	clients.splice(0).forEach((client) => client.clear());
});

it("marks a Saved job applied in one click, without a dialog", async () => {
	mount(saved);
	fireEvent.click(await screen.findByRole("button", { name: "Mark as applied" }));
	await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
	expect(api.update.mock.calls[0]?.[0]).toEqual({ id: saved.id, status: "applied" });
	expect(screen.queryByRole("dialog", { name: "Mark as applied" })).toBeNull();
	// The answers it saved show in the workspace without waiting for the cache to go stale.
	await waitFor(() =>
		expect(vi.mocked(clients[0]?.invalidateQueries)).toHaveBeenCalledWith({ queryKey: ["savedItems"] }),
	);
	expect(screen.queryByText("Confirm applied")).toBeNull();
});

it("moves a Saved job to Applied from the stage stepper, without a dialog", async () => {
	mount(saved);
	const stages = await screen.findByRole("list", { name: "Stages" });
	fireEvent.click(stages.querySelectorAll("button")[1] as HTMLButtonElement);
	await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
	expect(api.update.mock.calls[0]?.[0]).toEqual({ id: saved.id, status: "applied" });
	expect(screen.queryByText("Confirm applied")).toBeNull();
});

it("moves later stages the same way", async () => {
	mount({ ...saved, status: "applied" });
	fireEvent.click(await screen.findByRole("button", { name: /Move to/ }));
	await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
	expect(api.update.mock.calls[0]?.[0]).toEqual({ id: saved.id, status: "screening" });
});
