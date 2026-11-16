// @vitest-environment happy-dom
import type { Application } from "../types";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { ComponentProps, ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { ORPCError } from "@orpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
	bulkTrash: vi.fn(),
	updateTimelineEntry: vi.fn(),
	copyForJob: vi.fn(),
	bulkUpdate: vi.fn(),
	parsePosting: vi.fn(),
	findPosting: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	moveTo: vi.fn(),
	close: vi.fn(),
	remove: vi.fn(),
	invalidate: vi.fn(),
	confirm: vi.fn(),
	moveWithUndo: vi.fn(),
	trashWithUndo: vi.fn(),
	searchPostings: vi.fn(),
	webStatus: vi.fn(),
	capabilities: vi.fn(),
	navigate: vi.fn(),
}));
vi.mock("@/libs/orpc/client", () => ({
	client: { applications: { findPosting: api.findPosting, ai: { parsePosting: api.parsePosting } } },
	orpc: {
		ai: { capabilities: { queryOptions: () => ({ queryKey: ["capabilities"], queryFn: api.capabilities }) } },
		applications: {
			lanes: {
				get: {
					queryOptions: () => ({ queryKey: ["lanes"], queryFn: () => new Promise(() => {}) }),
					queryKey: () => ["lanes"],
				},
			},
			priorNoResponse: { queryOptions: () => ({ queryKey: ["prior"], queryFn: async () => [] }) },
			addNote: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
			updateTimelineEntry: { mutationOptions: () => ({ mutationFn: api.updateTimelineEntry }) },
			deleteTimelineEntry: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
			bulkTrash: { mutationOptions: () => ({ mutationFn: api.bulkTrash }) },
			bulkUpdate: { mutationOptions: () => ({ mutationFn: api.bulkUpdate }) },
			create: { mutationOptions: () => ({ mutationFn: api.create }) },
			update: { mutationOptions: () => ({ mutationFn: api.update }) },
			findPosting: {
				queryOptions: () => ({ queryKey: ["posting"], queryFn: api.findPosting }),
			},
			ai: {
				parsePosting: { mutationOptions: () => ({ mutationFn: api.parsePosting }) },
				searchPostings: { mutationOptions: () => ({ mutationFn: api.searchPostings }) },
			},
		},
		career: { savedItems: { queryOptions: () => ({ queryKey: ["offers"], queryFn: async () => [] }) } },
		webAccess: {
			status: { queryOptions: () => ({ queryKey: ["web-access"], queryFn: api.webStatus }) },
		},
		documents: {
			key: () => ["documents"],
			list: { queryOptions: () => ({ queryKey: ["documents"], queryFn: async () => [] }) },
			copyForJob: { mutationOptions: () => ({ mutationFn: api.copyForJob }) },
		},
	},
}));
vi.mock("../use-application-actions", () => ({
	useInvalidateApplications: () => api.invalidate,
	useApplicationActions: () => ({
		moveTo: api.moveTo,
		close: api.close,
		remove: { mutate: api.remove },
		update: { isError: false, variables: undefined },
		logFollowUp: { isPending: false, mutate: vi.fn() },
	}),
	useMoveWithUndo: () => api.moveWithUndo,
	useTrashWithUndo: () => api.trashWithUndo,
}));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => api.confirm }));
vi.mock("@reactive-resume/ui/hooks/use-breakpoint", () => ({ useBreakpoint: () => "desktop" }));
vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({
		hasUsableProvider: true,
		usableProviders: [{ id: "local", label: "Fictional provider", provider: "openai", model: "stub" }],
	}),
}));
vi.mock("@/dialogs/store", () => ({ useDialogStore: () => vi.fn() }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));
// The next step reads the account's reminder settings from the router context; these render without a router. Links
// render as plain anchors to the application's page.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useNavigate: () => api.navigate,
	Link: ({
		to: _to,
		params,
		children,
		...props
	}: ComponentProps<"a"> & { to: string; params: { applicationId: string } }) => (
		<a href={`/dashboard/applications/${params.applicationId}`} {...props}>
			{children}
		</a>
	),
	useRouteContext: () => ({ session: { user: { timezone: "UTC" } } }),
}));

import { APPLICATION_STATUSES } from "@reactive-resume/schema/applications/data";
import { DEFAULT_APPLICATION_SORT, OPEN_STAGES } from "@reactive-resume/schema/applications/filters";
import { resolveListColumns } from "@reactive-resume/schema/applications/layout";
import { AddApplicationDialog } from "./add-application-dialog";
import { ApplicationBoard } from "./board";
import { ColumnsButton } from "./columns-button";
import { Activity } from "./detail/activity";
import { ApplicationList } from "./list-view";
import { SortButton } from "./sort-button";

const application = (id: string, status: Application["status"]): Application => ({
	id,
	company: id === "closed" ? "Closed Co" : id === "moved" ? "Moved Co" : "Open Co",
	companyId: null,
	role: "Engineer",
	status,
	closedReason: status === "closed" ? "not-selected" : null,
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
	appliedAt: new Date(),
	createdAt: new Date(),
	updatedAt: new Date(),
	resumeId: null,
	jobDescription: null,
	postingSource: null,
	closesAt: null,
	matchScore: null,
	aiMetadata: null,
	resumeFileUrl: null,
	resumeFileName: null,
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
});
const clients: QueryClient[] = [];
const mount = (children: ReactNode) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
	clients.push(client);
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>{children}</I18nProvider>
		</QueryClientProvider>
	);
	return render(children, { wrapper });
};
beforeEach(() => {
	vi.clearAllMocks();
	api.capabilities.mockResolvedValue({ nativeWebSearch: 1 });
	sessionStorage.clear();
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	api.confirm.mockResolvedValue(true);
	api.findPosting.mockResolvedValue({ application: null });
	api.bulkTrash.mockResolvedValue({ deleted: 1 });
	api.webStatus.mockResolvedValue({ search: false });
	api.searchPostings.mockResolvedValue([]);
});
afterEach(() => {
	cleanup();
	clients.splice(0).forEach((client) => client.clear());
});

it("searches through the built-in DuckDuckGo search when nothing is set up, and points a block at a service", async () => {
	api.webStatus.mockResolvedValue({
		search: true,
		builtInSearch: true,
		provider: null,
		managed: false,
		canSave: true,
		searxng: false,
	});
	api.searchPostings.mockRejectedValue(new ORPCError("RATE_LIMIT_EXCEEDED"));
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	fireEvent.click(await screen.findByRole("tab", { name: "Search postings" }));
	const query = await screen.findByRole("textbox", { name: "Role, company or location" });
	expect(screen.getByText("Searches public job pages through DuckDuckGo. Only these words are sent.")).toBeTruthy();
	fireEvent.change(query, { target: { value: "Fictional engineer" } });
	fireEvent.click(screen.getByRole("button", { name: /^Search$/ }));

	expect(
		await screen.findByText(
			/DuckDuckGo · Too many requests\. Try again later\. A search service gives more reliable results\./,
		),
	).toBeTruthy();
	expect(screen.getByRole("button", { name: "Set up web access" })).toBeTruthy();
});

it("refreshes a rejected search connection in place without losing the query", async () => {
	const connection = { search: true, provider: "firecrawl", managed: false, canSave: true, searxng: false };
	api.webStatus.mockResolvedValue(connection);
	api.searchPostings.mockImplementation(async () => {
		api.webStatus.mockResolvedValue({
			...connection,
			search: false,
			testResult: { search: { success: false, error: "auth" }, read: { success: false, error: "auth" } },
		});
		throw new ORPCError("SEARCH_AUTH");
	});
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	fireEvent.click(await screen.findByRole("tab", { name: "Search postings" }));
	const query = await screen.findByRole("textbox", { name: "Role, company or location" });
	fireEvent.change(query, { target: { value: "Fictional engineer" } });
	fireEvent.click(screen.getByRole("button", { name: /^Search$/ }));

	expect(await screen.findByText(/The service rejected the API key/)).toBeTruthy();
	expect(screen.getByRole("button", { name: "Set up web access" })).toBeTruthy();
	expect((screen.getByRole("textbox", { name: "Role, company or location" }) as HTMLInputElement).value).toBe(
		"Fictional engineer",
	);
	await waitFor(() =>
		expect((screen.getByRole("button", { name: /^Search$/ }) as HTMLButtonElement).disabled).toBe(true),
	);
});

it("keeps native-search recovery after declining approval without dropping authored data", async () => {
	const connection = { search: true, provider: "firecrawl", managed: false, canSave: true, searxng: false };
	api.webStatus.mockResolvedValue(connection);
	api.searchPostings
		.mockImplementationOnce(async () => {
			api.webStatus.mockResolvedValue({
				...connection,
				search: false,
				testResult: { search: { success: false, error: "auth" } },
			});
			throw new ORPCError("SEARCH_AUTH");
		})
		.mockRejectedValueOnce(new DOMException("Declined", "AbortError"))
		.mockResolvedValueOnce([
			{ url: "https://jobs.example.com/design-engineer", title: "Fictional role", description: "" },
		]);
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	fireEvent.change(await screen.findByRole("textbox", { name: "Role" }), { target: { value: "Authored role" } });
	fireEvent.click(screen.getByRole("tab", { name: "Search postings" }));
	fireEvent.change(await screen.findByRole("textbox", { name: "Role, company or location" }), {
		target: { value: "Fictional engineer" },
	});
	fireEvent.click(screen.getByRole("button", { name: /^Search$/ }));
	fireEvent.click(await screen.findByRole("button", { name: "Retry with Fictional provider" }));
	await screen.findByText("Declined");
	await waitFor(() => expect(api.searchPostings).toHaveBeenCalledTimes(2));
	const retry = await screen.findByRole("button", { name: "Retry with Fictional provider" });
	await waitFor(() => expect(retry).not.toBeDisabled());
	fireEvent.click(retry);
	await screen.findByText("Fictional role");
	expect(screen.getByRole("textbox", { name: "Role, company or location" })).toHaveValue("Fictional engineer");
	fireEvent.click(screen.getByRole("tab", { name: "Link or posting text" }));
	expect(await screen.findByRole("textbox", { name: "Role" })).toHaveValue("Authored role");
	expect(api.searchPostings.mock.calls[2]?.[0]).toEqual({ query: "Fictional engineer", aiProviderId: "local" });
});

it("removes hidden closed applications from bulk selection before moving visible rows to Trash", () => {
	const rows = [application("open", "saved"), application("closed", "closed")];
	const list = (stages: readonly ApplicationStatus[]) => (
		<ApplicationList
			applications={rows}
			stages={stages}
			sort={DEFAULT_APPLICATION_SORT}
			onSortChange={vi.fn()}
			columns={resolveListColumns({})}
			onColumnResize={vi.fn()}
			selectedId={null}
			onOpen={vi.fn()}
		/>
	);
	const view = mount(list(APPLICATION_STATUSES));
	fireEvent.click(screen.getByRole("checkbox", { name: "Select Engineer at Open Co" }));
	fireEvent.click(screen.getByRole("checkbox", { name: "Select Engineer at Closed Co" }));
	expect(screen.getByText("2 selected")).toBeTruthy();
	view.rerender(list(OPEN_STAGES));
	expect(screen.queryByRole("checkbox", { name: "Select Engineer at Closed Co" })).toBeNull();
	expect(screen.getByText("1 selected")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
	expect(api.trashWithUndo).toHaveBeenCalledExactlyOnceWith([{ id: "open" }]);
});

it("offers one board-card open control and a separate options control without a dead draggable tab stop", async () => {
	const row = application("open", "saved");
	const onOpen = vi.fn();
	const view = mount(
		<ApplicationBoard
			applications={[row]}
			stages={OPEN_STAGES}
			sort={DEFAULT_APPLICATION_SORT}
			onColumnWidthChange={vi.fn()}
			onOpen={onOpen}
		/>,
	);
	const open = screen.getByRole("button", { name: "Open Co" });
	const options = screen.getByRole("button", { name: "Options for Engineer at Open Co" });
	expect(view.container.querySelector("button button, [role=button] button")).toBeNull();
	for (let parent = open.parentElement; parent && parent !== view.container; parent = parent.parentElement) {
		expect(parent.tabIndex).toBeLessThan(0);
	}
	fireEvent.click(open);
	expect(onOpen).toHaveBeenCalledExactlyOnceWith(row);
	fireEvent.click(options);
	await screen.findByRole("menu");
	expect(onOpen).toHaveBeenCalledTimes(1);
});

it("shows a column per chosen stage and keeps a changed card in the column it showed in, marked", () => {
	const moved = application("moved", "applied");
	mount(
		<ApplicationBoard
			applications={[application("open", "saved"), moved]}
			stages={["saved"]}
			stale={new Map([["moved", "saved"]])}
			sort={DEFAULT_APPLICATION_SORT}
			onColumnWidthChange={vi.fn()}
			onOpen={vi.fn()}
		/>,
	);
	expect(screen.getAllByRole("region").map((column) => column.getAttribute("aria-label"))).toEqual(["Saved"]);
	expect(screen.getByRole("region", { name: "Saved" }).textContent).toContain("Moved Co");
	expect(screen.getAllByText("Doesn't match the filters now")).toHaveLength(1);
});

it("groups the list by the chosen stages and sorts by the sort it's given", () => {
	const onSortChange = vi.fn();
	const rows = [application("a", "applied"), application("b", "applied"), application("c", "saved")];
	mount(
		<ApplicationList
			applications={rows}
			stages={["applied"]}
			sort={{ sort: "role", dir: "asc" }}
			onSortChange={onSortChange}
			columns={resolveListColumns({})}
			onColumnResize={vi.fn()}
			selectedId={null}
			onOpen={vi.fn()}
		/>,
	);
	expect(screen.getByRole("button", { name: /Applied/ })).toBeTruthy();
	expect(screen.queryByRole("button", { name: /Saved/ })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Role" }));
	expect(onSortChange).toHaveBeenCalledWith({ sort: "role", dir: "desc" });
});

it("does not report successful extraction when role and company are blank", async () => {
	// A page read takes the same blank-fields branch before the filledBy switch.
	const filledBy = "ai";
	api.parsePosting.mockResolvedValue({
		role: "",
		company: "",
		location: "",
		salary: "",
		requirements: [],
		jobDescription: "A general careers landing page",
		filledBy,
		postingSource: { method: "fetch", format: "text", truncated: false, completeness: "unknown" },
	});
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	fireEvent.change(await screen.findByRole("textbox", { name: "Job link or posting text" }), {
		target: { value: "https://example.test/careers" },
	});
	await readWithoutAi();
	await screen.findByText(/Some job details couldn't be read/);
	expect(screen.queryByText(/Found (the )?role,? (and )?company/)).toBeNull();
	expect((screen.getByRole("button", { name: "Save job" }) as HTMLButtonElement).disabled).toBe(true);
	expect((screen.getByRole("textbox", { name: "Saved description" }) as HTMLTextAreaElement).value).toBe(
		"A general careers landing page",
	);
	fireEvent.change(screen.getByRole("textbox", { name: "Role" }), { target: { value: "Engineer" } });
	fireEvent.change(screen.getByRole("textbox", { name: "Company" }), { target: { value: "Known Company" } });
	expect((screen.getByRole("button", { name: "Save job" }) as HTMLButtonElement).disabled).toBe(false);
});

it("keeps saving available when duplicate lookup fails, with an explicit warning", async () => {
	api.findPosting.mockRejectedValue(new Error("NOT_FOUND"));
	api.create.mockResolvedValue("saved");
	const onAdded = vi.fn();
	mount(
		<AddApplicationDialog
			open
			onOpenChange={vi.fn()}
			onAdded={onAdded}
			initialCapture={{
				url: "https://jobs.example.test/role",
				role: "Engineer",
				company: "Fictional",
				location: "",
				description: "Visible posting",
				truncated: false,
			}}
		/>,
	);
	await screen.findByText(/Duplicate check unavailable/);
	const save = screen.getByRole("button", { name: "Save job" }) as HTMLButtonElement;
	expect(save.disabled).toBe(false);
	fireEvent.click(save);
	await waitFor(() => expect(onAdded).toHaveBeenCalledWith("saved"));
});

// A clipped capture of an already-tracked job has no description: updating it must keep the saved one.
it("updates a tracked job's posting without blanking its saved description", async () => {
	api.findPosting.mockResolvedValue({ application: { ...application("tracked", "saved"), jobDescription: "Saved" } });
	api.update.mockResolvedValue(undefined);
	mount(
		<AddApplicationDialog
			open
			onOpenChange={vi.fn()}
			onAdded={vi.fn()}
			initialCapture={{
				url: "https://jobs.example.test/role",
				role: "Engineer",
				company: "Fictional",
				location: "",
				description: "",
				truncated: false,
			}}
		/>,
	);
	await screen.findByRole("button", { name: "Update posting details" });
	expect(screen.queryByRole("textbox", { name: "Company" })).not.toBeInTheDocument();
	expect(screen.queryByRole("textbox", { name: "Role" })).not.toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "Update posting details" }));
	await waitFor(() => expect(api.update).toHaveBeenCalled());
	expect(api.update.mock.lastCall?.[0]).not.toHaveProperty("jobDescription");
});

it("keeps what was pasted when the dialog closes and reopens (A3-39)", async () => {
	const view = mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	fireEvent.change(await screen.findByRole("textbox", { name: "Job link or posting text" }), {
		target: { value: "Build tools for a fictional company." },
	});
	view.rerender(<AddApplicationDialog open={false} onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	view.rerender(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	expect(
		((await screen.findByRole("textbox", { name: "Job link or posting text" })) as HTMLTextAreaElement).value,
	).toBe("Build tools for a fictional company.");
});

it("offers only the explicit AI read for pasted text", async () => {
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	fireEvent.change(await screen.findByRole("textbox", { name: "Job link or posting text" }), {
		target: { value: "Build tools for a fictional company." },
	});
	expect(screen.queryByRole("button", { name: "Read the page without AI" })).toBeNull();
	expect(screen.getByRole("button", { name: "Read it" })).toBeTruthy();
	expect(api.parsePosting).not.toHaveBeenCalled();
});

it("never dispatches a no-AI parse to a server that cannot confirm support, while explicit AI still works", async () => {
	api.findPosting.mockRejectedValue(new Error("NOT_FOUND"));
	api.parsePosting.mockResolvedValue({
		role: "Engineer",
		company: "Fictional",
		location: "",
		salary: "",
		requirements: [],
		jobDescription: "Visible posting",
		filledBy: "ai",
		postingSource: { method: "fetch", format: "text", truncated: false, completeness: "unknown" },
	});
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	fireEvent.change(await screen.findByRole("textbox", { name: "Job link or posting text" }), {
		target: { value: "https://example.test/role" },
	});
	await readWithoutAi();
	await screen.findByText(/Reading without AI couldn't be confirmed/);
	expect(api.parsePosting).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Read it" }));
	await waitFor(() =>
		expect(api.parsePosting).toHaveBeenCalledWith(
			{ input: "https://example.test/role", useAI: true },
			expect.anything(),
		),
	);
});

it("shows pasted text once when AI couldn't read it, and saves that text (J2-20)", async () => {
	const posting = "VP of Engineering\nFieldnote · Remote\nRun budget and vendor relationships.";
	api.parsePosting.mockResolvedValue({
		role: "",
		company: "",
		location: "",
		salary: "",
		requirements: [],
		jobDescription: posting,
		filledBy: "none",
		enrichmentWarning: true,
		postingSource: { method: "paste", format: "text", truncated: false, completeness: "unknown" },
	});
	api.create.mockResolvedValue("saved");
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	fireEvent.change(await screen.findByRole("textbox", { name: "Job link or posting text" }), {
		target: { value: posting },
	});
	fireEvent.click(screen.getByRole("button", { name: "Read it" }));
	await screen.findByText(/AI couldn't fill the details/);
	expect(screen.queryByText(/Some job details couldn't be read/)).toBeNull();
	expect(screen.queryByRole("textbox", { name: "Saved description" })).toBeNull();
	fireEvent.change(screen.getByRole("textbox", { name: "Role" }), { target: { value: "VP of Engineering" } });
	fireEvent.change(screen.getByRole("textbox", { name: "Company" }), { target: { value: "Fieldnote" } });
	fireEvent.click(screen.getByRole("button", { name: "Save job" }));
	await waitFor(() => expect(api.create.mock.calls[0]?.[0]).toMatchObject({ jobDescription: posting }));
});

it("shows the posting once when a link couldn't be read, its text was pasted and AI couldn't read that either (J2-20)", async () => {
	const posting = "VP of Engineering\nFieldnote · Remote\nRun budget and vendor relationships.";
	api.parsePosting
		.mockRejectedValueOnce(new ORPCError("POSTING_UNREADABLE", { status: 422, message: "That link couldn't be read." }))
		.mockResolvedValue({
			role: "",
			company: "",
			location: "",
			salary: "",
			requirements: [],
			jobDescription: posting,
			filledBy: "none",
			enrichmentWarning: true,
			postingSource: { method: "paste", format: "text", truncated: false, completeness: "unknown" },
		});
	api.create.mockResolvedValue("saved");
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	fireEvent.change(await screen.findByRole("textbox", { name: "Job link or posting text" }), {
		target: { value: "https://jobs.example.test/vp" },
	});
	await readWithoutAi();
	fireEvent.change(await screen.findByRole("textbox", { name: "Pasted description" }), { target: { value: posting } });
	fireEvent.click(screen.getByRole("button", { name: "Read it" }));
	await screen.findByText(/AI couldn't fill the details/);
	expect(screen.queryByText(/Some job details couldn't be read/)).toBeNull();

	expect(screen.getAllByRole("textbox").filter((box) => (box as HTMLTextAreaElement).value === posting)).toHaveLength(
		1,
	);
	fireEvent.change(screen.getByRole("textbox", { name: "Role" }), { target: { value: "VP of Engineering" } });
	fireEvent.change(screen.getByRole("textbox", { name: "Company" }), { target: { value: "Fieldnote" } });
	fireEvent.click(screen.getByRole("button", { name: "Save job" }));
	await waitFor(() =>
		expect(api.create.mock.calls[0]?.[0]).toMatchObject({
			jobDescription: posting,
			sourceUrl: "https://jobs.example.test/vp",
		}),
	);
});

it("replaces prior posting autofill while preserving authored fields, including edits made during the read", async () => {
	const posting = (role: string, company: string, location: string, salary: string) => ({
		role,
		company,
		location,
		salary,
		requirements: [],
		jobDescription: "Fictional posting",
		filledBy: "ai",
		postingSource: { method: "paste", format: "text", truncated: false, completeness: "unknown" },
	});
	api.parsePosting.mockResolvedValueOnce(posting("First role", "First Co", "Berlin", "100"));
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	const input = await screen.findByRole("textbox", { name: "Job link or posting text" });
	fireEvent.change(input, { target: { value: "First fictional posting text" } });
	fireEvent.click(screen.getByRole("button", { name: "Read it" }));
	await waitFor(() => expect(screen.getByRole("textbox", { name: "Role" })).toHaveValue("First role"));
	let finish = (_result: ReturnType<typeof posting>) => {};
	api.parsePosting.mockReturnValueOnce(
		new Promise((resolve) => {
			finish = resolve;
		}),
	);
	fireEvent.change(input, { target: { value: "Second fictional posting text" } });
	fireEvent.click(screen.getByRole("button", { name: "Read it" }));
	fireEvent.change(screen.getByRole("textbox", { name: "Company" }), { target: { value: "My authored company" } });
	fireEvent.change(screen.getByRole("textbox", { name: "Salary" }), { target: { value: "" } });
	finish(posting("Second role", "Second Co", "Paris", "200"));
	await waitFor(() => expect(screen.getByRole("textbox", { name: "Role" })).toHaveValue("Second role"));
	expect(screen.getByRole("textbox", { name: "Company" })).toHaveValue("My authored company");
	expect(screen.getByRole("textbox", { name: "Location" })).toHaveValue("Paris");
	expect(screen.getByRole("textbox", { name: "Salary" })).toHaveValue("");
});

it("keeps the link's failure above paste recovery instead of replacing it with idle guidance", async () => {
	api.parsePosting.mockRejectedValue(
		new ORPCError("POSTING_UNREADABLE", {
			status: 422,
			message: "That link is a list of jobs. Open one posting and paste its link, or paste the posting text below.",
		}),
	);
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	fireEvent.change(await screen.findByRole("textbox", { name: "Job link or posting text" }), {
		target: { value: "https://jobs.lever.co/spotify" },
	});
	await readWithoutAi();
	await screen.findByRole("textbox", { name: "Pasted description" });
	const error = await screen.findByRole("alert");
	expect(error.textContent).toContain("That link is a list of jobs");
	expect(screen.queryByText(/Fill in the role and company, or use Set up AI/)).toBeNull();
	// Changing the pasted text is an intentional new attempt; it clears the old reason.
	fireEvent.change(screen.getByRole("textbox", { name: "Pasted description" }), {
		target: { value: "A full posting" },
	});
	await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

it("keeps one failure status when optional AI enrichment fails for a captured posting", async () => {
	const posting = "Build accessible tools for a fictional studio.";
	api.parsePosting.mockResolvedValue({
		role: "",
		company: "",
		location: "",
		salary: "",
		requirements: [],
		jobDescription: posting,
		filledBy: "none",
		enrichmentWarning: true,
		postingSource: { method: "paste", format: "text", truncated: false, completeness: "unknown" },
	});
	mount(
		<AddApplicationDialog
			open
			onOpenChange={vi.fn()}
			onAdded={vi.fn()}
			initialCapture={{
				url: "https://jobs.example.test/captured",
				role: "Tools Engineer",
				company: "Fictional Studio",
				location: "",
				description: posting,
				truncated: false,
			}}
		/>,
	);
	fireEvent.click(await screen.findByRole("button", { name: "Read it" }));
	await waitFor(() => expect(api.parsePosting).toHaveBeenCalledTimes(1));
	expect(await screen.findAllByText(/AI couldn't fill the details/)).toHaveLength(1);
	expect(screen.queryByText(/Some job details couldn't be read/)).toBeNull();
	expect(screen.getByRole("textbox", { name: "Saved description" })).toHaveValue(posting);
});

it("shows the chosen columns in order, and a new column's heading sorts it newest first", () => {
	const onSortChange = vi.fn();
	mount(
		<ApplicationList
			applications={[application("a", "applied")]}
			stages={OPEN_STAGES}
			sort={DEFAULT_APPLICATION_SORT}
			onSortChange={onSortChange}
			columns={resolveListColumns({ listColumns: [{ id: "added" }, { id: "salary" }, { id: "next", width: 240 }] })}
			onColumnResize={vi.fn()}
			selectedId={null}
			onOpen={vi.fn()}
		/>,
	);
	const headings = [...document.querySelectorAll("thead th")].map((heading) => heading.textContent);
	expect(headings).toEqual(["Select", "Role", "Added", "Salary", "Next step"]);
	const widths = [...document.querySelectorAll("col")].map((col) => col.style.width);
	expect(widths).toEqual(["40px", "", "76px", "124px", "240px"]);
	fireEvent.click(screen.getByRole("button", { name: "Added" }));
	expect(onSortChange).toHaveBeenCalledWith({ sort: "added", dir: "desc" });
});

it("resizes a List column with the arrow keys and resets it on double-click", () => {
	const onColumnResize = vi.fn();
	const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
	Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1400 });
	try {
		mount(
			<ApplicationList
				applications={[application("a", "applied")]}
				stages={OPEN_STAGES}
				sort={DEFAULT_APPLICATION_SORT}
				onSortChange={vi.fn()}
				columns={resolveListColumns({})}
				onColumnResize={onColumnResize}
				selectedId={null}
				onOpen={vi.fn()}
			/>,
		);
		const line = screen.getByRole("separator", { name: "Resize Next step" });
		expect(line.getAttribute("aria-valuenow")).toBe("200");
		// The line sits on the column's start edge: moving it left widens the column, right narrows it.
		fireEvent.keyDown(line, { key: "ArrowLeft" });
		expect(onColumnResize).toHaveBeenLastCalledWith("next", 208);
		fireEvent.keyDown(line, { key: "ArrowRight", shiftKey: true });
		expect(onColumnResize).toHaveBeenLastCalledWith("next", 168);
		fireEvent.doubleClick(line);
		expect(onColumnResize).toHaveBeenLastCalledWith("next", null);
	} finally {
		if (width) Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
	}
});

it("never resizes a List column past where Role keeps its minimum", () => {
	const onColumnResize = vi.fn();
	const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
	// 900 less 40 for the checkboxes, 240 for Role and 408 for the other default columns leaves Next step 212px at most.
	Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 900 });
	try {
		mount(
			<ApplicationList
				applications={[application("a", "applied")]}
				stages={OPEN_STAGES}
				sort={DEFAULT_APPLICATION_SORT}
				onSortChange={vi.fn()}
				columns={resolveListColumns({})}
				onColumnResize={onColumnResize}
				selectedId={null}
				onOpen={vi.fn()}
			/>,
		);
		const line = screen.getByRole("separator", { name: "Resize Next step" });
		fireEvent.keyDown(line, { key: "ArrowLeft", shiftKey: true });
		expect(onColumnResize).toHaveBeenLastCalledWith("next", 212);
	} finally {
		if (width) Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
	}
});

it("sorts the cards in each Board column and resizes every column together", () => {
	const onColumnWidthChange = vi.fn();
	const low = { ...application("low", "saved"), company: "Low Co", searchFit: 80 };
	const high = { ...application("high", "saved"), company: "High Co", searchFit: 95 };
	mount(
		<ApplicationBoard
			applications={[low, high]}
			stages={["saved", "applied"]}
			sort={{ sort: "fit", dir: "desc" }}
			columnWidth={300}
			onColumnWidthChange={onColumnWidthChange}
			onOpen={vi.fn()}
		/>,
	);
	const saved = screen.getByRole("region", { name: "Saved" });
	expect(saved.textContent?.indexOf("High Co")).toBeLessThan(saved.textContent?.indexOf("Low Co") ?? 0);
	expect(saved.style.width).toBe("300px");
	expect(screen.getByRole("region", { name: "Applied" }).style.width).toBe("300px");

	const [line] = screen.getAllByRole("separator", { name: "Resize the columns" });
	if (!line) throw new Error("no resize line");
	// The line is on the column's end side, so moving it right widens every column.
	fireEvent.keyDown(line, { key: "ArrowRight" });
	expect(onColumnWidthChange).toHaveBeenLastCalledWith(308);
	fireEvent.keyDown(line, { key: "ArrowLeft", shiftKey: true });
	expect(onColumnWidthChange).toHaveBeenLastCalledWith(268);
	fireEvent.doubleClick(line);
	expect(onColumnWidthChange).toHaveBeenLastCalledWith(null);
});

it("picks a sort field in its own direction and switches the direction", async () => {
	const onChange = vi.fn();
	mount(<SortButton sort={DEFAULT_APPLICATION_SORT} onChange={onChange} />);
	fireEvent.click(screen.getByRole("button", { name: /Sort: Updated/ }));
	fireEvent.click(await screen.findByRole("radio", { name: "Company" }));
	expect(onChange).toHaveBeenLastCalledWith({ sort: "company", dir: "asc" });
	fireEvent.click(screen.getByRole("radio", { name: "Oldest first" }));
	expect(onChange).toHaveBeenLastCalledWith({ sort: "updated", dir: "asc" });
});

it("adds a column at the end, hides one and resets from the Columns menu", async () => {
	const onChange = vi.fn();
	const onReset = vi.fn();
	mount(<ColumnsButton columns={[{ id: "next" }, { id: "fit", width: 70 }]} onChange={onChange} onReset={onReset} />);
	fireEvent.click(screen.getByRole("button", { name: "Columns" }));
	fireEvent.click(await screen.findByRole("checkbox", { name: "Added" }));
	expect(onChange).toHaveBeenLastCalledWith([{ id: "next" }, { id: "fit", width: 70 }, { id: "added" }]);
	fireEvent.click(screen.getByRole("checkbox", { name: "Next step" }));
	expect(onChange).toHaveBeenLastCalledWith([{ id: "fit", width: 70 }]);
	fireEvent.click(screen.getByRole("button", { name: "Reset" }));
	expect(onReset).toHaveBeenCalledOnce();
});

it("leaves the widths alone when a resize line is only clicked", () => {
	const onColumnResize = vi.fn();
	const onColumnWidthChange = vi.fn();
	mount(
		<>
			<ApplicationList
				applications={[application("a", "applied")]}
				stages={OPEN_STAGES}
				sort={DEFAULT_APPLICATION_SORT}
				onSortChange={vi.fn()}
				columns={resolveListColumns({})}
				onColumnResize={onColumnResize}
				selectedId={null}
				onOpen={vi.fn()}
			/>
			<ApplicationBoard
				applications={[application("b", "saved")]}
				stages={OPEN_STAGES}
				sort={DEFAULT_APPLICATION_SORT}
				onColumnWidthChange={onColumnWidthChange}
				onOpen={vi.fn()}
			/>
		</>,
	);
	const listLine = screen.getByRole("separator", { name: "Resize Next step" });
	fireEvent.pointerDown(listLine, { button: 0, clientX: 300, pointerId: 1 });
	fireEvent.pointerUp(listLine, { button: 0, clientX: 300, pointerId: 1 });
	const [boardLine] = screen.getAllByRole("separator", { name: "Resize the columns" });
	if (!boardLine) throw new Error("no board line");
	fireEvent.pointerDown(boardLine, { button: 0, clientX: 300, pointerId: 2 });
	fireEvent.pointerUp(boardLine, { button: 0, clientX: 300, pointerId: 2 });
	expect(onColumnResize).not.toHaveBeenCalled();
	expect(onColumnWidthChange).not.toHaveBeenCalled();
});

async function readWithoutAi() {
	const direct = screen.queryByRole("button", { name: "Read the page without AI" });
	if (direct) return userEvent.click(direct);
	await userEvent.click(screen.getByRole("button", { name: "Reading options" }));
	await userEvent.click(await screen.findByRole("menuitem", { name: "Read the page without AI" }));
}

it("edits a timeline note separately from its date without dropping either value", async () => {
	const user = userEvent.setup();
	api.updateTimelineEntry.mockResolvedValue(undefined);
	const item = {
		...application("timeline", "applied"),
		activity: [{ id: "note", type: "note" as const, at: new Date("2026-11-05T12:00:00Z"), text: "Sent availability" }],
	};
	mount(<Activity application={item} onOpenInterview={vi.fn()} />);
	await user.click(screen.getByRole("button", { name: "Options for this entry" }));
	await user.click(await screen.findByRole("menuitem", { name: "Edit note…" }));
	expect(screen.queryByLabelText("Date")).toBeNull();
	fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "Confirmed availability" } });
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(api.updateTimelineEntry).toHaveBeenCalledWith(
			{ id: "timeline", entryId: "note", date: "2026-11-05", text: "Confirmed availability" },
			expect.anything(),
		),
	);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	await user.click(screen.getByRole("button", { name: "Options for this entry" }));
	await user.click(await screen.findByRole("menuitem", { name: "Edit date…" }));
	expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull();
	fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-06" } });
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(api.updateTimelineEntry).toHaveBeenLastCalledWith(
			{ id: "timeline", entryId: "note", date: "2026-11-06" },
			expect.anything(),
		),
	);
});

it("saves the deadline the posting gives with the new job", async () => {
	api.parsePosting.mockResolvedValue({
		role: "Engineer",
		company: "Fictional",
		location: "",
		salary: "",
		requirements: [],
		jobDescription: "Build tools",
		filledBy: "ai",
		closesAt: "2026-12-01T23:59:59.000Z",
		postingSource: { method: "fetch", format: "text", truncated: false, completeness: "unknown" },
	});
	api.create.mockResolvedValue("saved");
	mount(<AddApplicationDialog open onOpenChange={vi.fn()} onAdded={vi.fn()} />);
	fireEvent.change(await screen.findByRole("textbox", { name: "Job link or posting text" }), {
		target: { value: "https://jobs.example.test/role" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Read it" }));
	await waitFor(() =>
		expect((screen.getByRole("textbox", { name: "Role" }) as HTMLInputElement).value).toBe("Engineer"),
	);
	fireEvent.click(screen.getByRole("button", { name: "Save job" }));
	await waitFor(() =>
		expect(api.create.mock.calls[0]?.[0]).toMatchObject({ closesAt: new Date("2026-12-01T23:59:59.000Z") }),
	);
});
