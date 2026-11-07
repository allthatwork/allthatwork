// @vitest-environment happy-dom
import type { Application } from "../types";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
	bulkDelete: vi.fn(),
	bulkUpdate: vi.fn(),
	parsePosting: vi.fn(),
	create: vi.fn(),
	moveTo: vi.fn(),
	close: vi.fn(),
	remove: vi.fn(),
	invalidate: vi.fn(),
	confirm: vi.fn(),
}));
vi.mock("@/libs/orpc/client", () => ({
	client: { applications: { ai: { parsePosting: api.parsePosting } } },
	orpc: {
		applications: {
			bulkDelete: { mutationOptions: () => ({ mutationFn: api.bulkDelete }) },
			bulkUpdate: { mutationOptions: () => ({ mutationFn: api.bulkUpdate }) },
			create: { mutationOptions: () => ({ mutationFn: api.create }) },
			ai: {
				parsePosting: { mutationOptions: () => ({ mutationFn: api.parsePosting }) },
				searchPostings: { mutationOptions: () => ({ mutationFn: async () => [] }) },
			},
		},
		webAccess: {
			status: { queryOptions: () => ({ queryKey: ["web-access"], queryFn: async () => ({ search: false }) }) },
		},
		documents: { list: { queryOptions: () => ({ queryKey: ["documents"], queryFn: async () => [] }) } },
	},
}));
vi.mock("../use-application-actions", () => ({
	useInvalidateApplications: () => api.invalidate,
	useApplicationActions: () => ({ moveTo: api.moveTo, close: api.close, remove: { mutate: api.remove } }),
}));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => api.confirm }));
vi.mock("@reactive-resume/ui/hooks/use-breakpoint", () => ({ useBreakpoint: () => "desktop" }));
vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({ hasUsableProvider: true }),
}));
vi.mock("@/dialogs/store", () => ({ useDialogStore: () => vi.fn() }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));
// The next step reads the account's reminder settings from the router context; these render without a router.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useRouteContext: () => ({}),
}));

import { APPLICATION_STATUSES } from "@reactive-resume/schema/applications/data";
import { DEFAULT_APPLICATION_SORT, OPEN_STAGES } from "@reactive-resume/schema/applications/filters";
import { resolveListColumns } from "@reactive-resume/schema/applications/layout";
import { AddApplicationDialog } from "./add-application-dialog";
import { ApplicationBoard } from "./board";
import { ColumnsButton } from "./columns-button";
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
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	api.confirm.mockResolvedValue(true);
	api.bulkDelete.mockResolvedValue({ deleted: 1 });
});
afterEach(() => {
	cleanup();
	clients.splice(0).forEach((client) => client.clear());
});

it("removes hidden closed applications from bulk selection before deleting visible rows", async () => {
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
	fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
	await waitFor(() => expect(api.bulkDelete.mock.calls[0]?.[0]).toEqual({ ids: ["open"] }));
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
	const open = screen.getByRole("button", { name: "Engineer Open Co" });
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

it.each(["ai", "page"])(
	"does not report successful %s extraction when role and company are blank",
	async (filledBy) => {
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
		fireEvent.click(screen.getByRole("button", { name: "Read posting" }));
		await screen.findByText(/Some job details couldn't be read/);
		expect(screen.queryByText(/Found (the )?role,? (and )?company/)).toBeNull();
		expect((screen.getByRole("button", { name: "Save job" }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole("textbox", { name: "Saved description" }) as HTMLTextAreaElement).value).toBe(
			"A general careers landing page",
		);
		fireEvent.change(screen.getByRole("textbox", { name: "Role" }), { target: { value: "Engineer" } });
		fireEvent.change(screen.getByRole("textbox", { name: "Company" }), { target: { value: "Known Company" } });
		expect((screen.getByRole("button", { name: "Save job" }) as HTMLButtonElement).disabled).toBe(false);
	},
);

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
