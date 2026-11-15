import type { ApplicationSummary } from "../types";
// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { APPLICATION_STATUSES } from "@reactive-resume/schema/applications/data";
import { DEFAULT_APPLICATION_SORT } from "@reactive-resume/schema/applications/filters";
import { createDefaultApplicationLanes } from "@reactive-resume/schema/applications/lanes";
import { DEFAULT_LIST_COLUMNS, LIST_COLUMN_WIDTHS } from "@reactive-resume/schema/applications/layout";
import { ApplicationList } from "./list-view";

const mocks = vi.hoisted(() => ({
	breakpoint: "desktop",
	timeZone: "UTC",
	invalidate: vi.fn(),
	setBuildStatus: vi.fn(),
	moveWithUndo: vi.fn(),
	trashWithUndo: vi.fn(),
	logFollowUp: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
	useRouteContext: () => ({ session: { user: { timezone: mocks.timeZone } } }),
}));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		applications: {
			lanes: {
				get: {
					queryOptions: () => ({ queryKey: ["lanes"], queryFn: () => new Promise(() => {}) }),
					queryKey: () => ["lanes"],
				},
			},
			priorNoResponse: { queryOptions: () => ({ queryKey: ["prior"], queryFn: async () => [] }) },
			bulkUpdate: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
			bulkTrash: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
		},
		career: { savedItems: { queryOptions: () => ({ queryKey: ["offers"], queryFn: async () => [] }) } },
	},
}));
vi.mock("../use-application-actions", () => ({
	useInvalidateApplications: () => mocks.invalidate,
	useMoveWithUndo: () => mocks.moveWithUndo,
	useTrashWithUndo: () => mocks.trashWithUndo,
	useApplicationActions: () => ({
		setBuildStatus: mocks.setBuildStatus,
		logFollowUp: { isPending: false, mutate: mocks.logFollowUp },
	}),
}));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@reactive-resume/ui/hooks/use-breakpoint", () => ({ useBreakpoint: () => mocks.breakpoint }));

const LONG_NOTE =
	"Call Priya back about the take-home timeline, then email a summary of the referral conversation " +
	"and the salary band she mentioned on Tuesday";

const COLUMNS = DEFAULT_LIST_COLUMNS.map((id) => ({ id, width: LIST_COLUMN_WIDTHS[id].width }));

const application = (over: Partial<ApplicationSummary> = {}): ApplicationSummary =>
	({
		id: "app-1",
		status: "applied",
		role: "Senior Frontend Engineer",
		company: "Globex",
		location: "San Francisco",
		appliedAt: new Date("2026-10-01T00:00:00.000Z"),
		createdAt: new Date("2026-10-01T00:00:00.000Z"),
		updatedAt: new Date("2026-10-19T00:00:00.000Z"),
		activity: [],
		followUpAt: null,
		followUpNote: null,
		resumeId: null,
		coverLetterId: null,
		closedReason: null,
		tags: [],
		searchFit: null,
		targetingFit: null,
		targetingBuildStatus: null,
		...over,
	}) as ApplicationSummary;

function renderList(
	applications: ApplicationSummary[],
	breakpoint = "desktop",
	onOpen = vi.fn(),
	onTagSelect = vi.fn(),
) {
	mocks.breakpoint = breakpoint;
	i18n.load("en", {});
	i18n.activate("en");
	const client = new QueryClient();
	client.setQueryData(["lanes"], { lanes: createDefaultApplicationLanes(), revision: 1 });
	const tree = (rows: ApplicationSummary[]) => (
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>
				<ApplicationList
					applications={rows}
					stages={APPLICATION_STATUSES}
					sort={DEFAULT_APPLICATION_SORT}
					onSortChange={vi.fn()}
					columns={COLUMNS}
					onColumnResize={vi.fn()}
					selectedId={null}
					onOpen={onOpen}
					onTagSelect={onTagSelect}
				/>
			</I18nProvider>
		</QueryClientProvider>
	);
	const view = render(tree(applications));
	return { ...view, update: (rows: ApplicationSummary[]) => view.rerender(tree(rows)) };
}

it("spans Role, the checkbox and the chosen columns in a group heading", () => {
	const { container } = renderList([application()]);
	expect(container.querySelector("table")?.className).toContain("table-fixed");
	expect(container.querySelector("th[scope=colgroup]")?.getAttribute("colspan")).toBe(String(COLUMNS.length + 2));
});

it("keeps automatic layout and single-cell rows on phones", () => {
	const { container } = renderList(
		[application({ followUpAt: new Date("2026-10-25T00:00:00.000Z"), followUpNote: LONG_NOTE })],
		"mobile",
	);

	expect(container.querySelector("table")?.className).not.toContain("table-fixed");
	expect(container.querySelector("thead")).toBeNull();
	expect(container.querySelector("th[scope=colgroup]")?.getAttribute("colspan")).toBe("1");
	// The company is its own element (it keeps its own direction); the line reads as one.
	expect(container.querySelector("tbody [data-application-open] span:last-of-type")?.textContent).toBe(
		`Globex · ${LONG_NOTE}`,
	);
});

const twoApplications = () => [
	application(),
	application({ id: "app-2", role: "Product Designer", company: "Initech", location: "Austin" }),
];

it.each(["desktop", "mobile"] as const)("opens the clicked row's application on %s", (breakpoint) => {
	const onOpen = vi.fn();
	renderList(twoApplications(), breakpoint, onOpen);

	fireEvent.click(screen.getByText("Product Designer").closest("tr") as HTMLElement);

	expect(onOpen).toHaveBeenCalledOnce();
	expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "app-2" }));
});

it.each(["desktop", "mobile"] as const)("opens once from the role button on %s", async (breakpoint) => {
	const onOpen = vi.fn();
	renderList(twoApplications(), breakpoint, onOpen);
	const user = userEvent.setup();
	const button = screen.getByRole("button", { name: /Product Designer/ });

	await user.click(button);
	expect(onOpen).toHaveBeenCalledOnce();
	onOpen.mockClear();
	await user.keyboard("{Enter}");
	expect(onOpen).toHaveBeenCalledOnce();
	onOpen.mockClear();
	await user.keyboard(" ");
	expect(onOpen).toHaveBeenCalledOnce();
	expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "app-2" }));
});

it("selects a row without opening it", () => {
	const onOpen = vi.fn();
	renderList(twoApplications(), "desktop", onOpen);

	const checkbox = screen.getByRole("checkbox", { name: "Select Product Designer at Initech" });
	fireEvent.click(checkbox);
	fireEvent.click(checkbox.closest("td") as HTMLElement);

	expect(onOpen).not.toHaveBeenCalled();
	expect(checkbox.getAttribute("aria-checked")).toBe("true");
});

it("queues a build from the Build column without opening the row", () => {
	const onOpen = vi.fn();
	mocks.setBuildStatus.mockReset();
	renderList(twoApplications(), "desktop", onOpen);

	const build = screen.getByRole("checkbox", { name: "Build resume for Product Designer at Initech" });
	fireEvent.click(build);
	fireEvent.click(build.closest("td") as HTMLElement);

	expect(mocks.setBuildStatus).toHaveBeenCalledWith(expect.objectContaining({ id: "app-2" }), "build");
	expect(onOpen).not.toHaveBeenCalled();
});

it.each(["desktop", "mobile"] as const)(
	"does not stretch a click target over the page on %s, since Safari ignores position on table rows",
	(breakpoint) => {
		const { container } = renderList(twoApplications(), breakpoint);

		expect(container.querySelector("tbody [class*='after:absolute']")).toBeNull();
	},
);

it("passes a tag chip selection to onTagSelect without opening the row", () => {
	const onOpen = vi.fn();
	const onTagSelect = vi.fn();
	renderList([application({ tags: ["remote", "design"] })], "desktop", onOpen, onTagSelect);

	fireEvent.click(screen.getByRole("button", { name: "Filter by remote" }));

	expect(onTagSelect).toHaveBeenCalledExactlyOnceWith("remote");
	expect(onOpen).not.toHaveBeenCalled();
});

it("selects the visible rows from the header and shows an indeterminate state for a partial selection", () => {
	renderList(twoApplications());
	const all = screen.getByRole("checkbox", { name: "Select all visible applications" });
	const product = screen.getByRole("checkbox", { name: "Select Product Designer at Initech" });

	fireEvent.click(product);
	expect(all).toHaveAttribute("aria-checked", "mixed");

	fireEvent.click(all);
	expect(all).toHaveAttribute("aria-checked", "true");
	expect(product).toHaveAttribute("aria-checked", "true");
	expect(screen.getByText("2 selected")).toBeTruthy();

	fireEvent.click(all);
	expect(all).toHaveAttribute("aria-checked", "false");
	expect(product).toHaveAttribute("aria-checked", "false");
	expect(screen.queryByText("2 selected")).toBeNull();
});

it("leaves collapsed groups out of the header selection", () => {
	renderList([
		application({ id: "app-1", role: "Alpha" }),
		application({ id: "app-2", role: "Beta", status: "interview" }),
	]);

	fireEvent.click(screen.getByRole("button", { name: "Interview 1" }));
	fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible applications" }));
	fireEvent.click(screen.getByRole("button", { name: "Interview 1" }));

	expect(screen.getByRole("checkbox", { name: "Select Alpha at Globex" })).toHaveAttribute("aria-checked", "true");
	expect(screen.getByRole("checkbox", { name: "Select Beta at Globex" })).toHaveAttribute("aria-checked", "false");
});

it("moves and closes the checked rows with Undo instead of writing at once (J2-18)", async () => {
	mocks.moveWithUndo.mockClear();
	renderList(twoApplications());
	fireEvent.click(screen.getByRole("checkbox", { name: "Select Product Designer at Initech" }));

	await userEvent.click(screen.getByRole("button", { name: "Move to…" }));
	await userEvent.click(await screen.findByRole("menuitem", { name: "Interview" }));
	expect(mocks.moveWithUndo).toHaveBeenLastCalledWith(
		expect.objectContaining({
			applications: [{ id: "app-2" }],
			lane: expect.objectContaining({ category: "interview" }),
			description: "1 application moved to Interview",
		}),
	);

	fireEvent.click(screen.getByRole("checkbox", { name: "Select Product Designer at Initech" }));
	await userEvent.click(screen.getByRole("button", { name: "Close…" }));
	await userEvent.click(await screen.findByRole("menuitem", { name: "Accepted another offer" }));
	expect(mocks.moveWithUndo).toHaveBeenLastCalledWith(
		expect.objectContaining({
			applications: [{ id: "app-2" }],
			lane: expect.objectContaining({ category: "closed" }),
			closedReason: "accepted-other",
		}),
	);
});

it("triages only focused rows in displayed order, preserving identity across lane moves and hiding", async () => {
	mocks.moveWithUndo.mockClear();
	mocks.logFollowUp.mockClear();
	const user = userEvent.setup();
	const onOpen = vi.fn();
	const first = application({ id: "a", role: "Alpha", status: "applied" });
	const second = application({ id: "b", role: "Beta", status: "interview" });
	const rows = [first, second];
	const view = renderList(rows, "desktop", onOpen);
	const alpha = () => screen.getByRole("button", { name: /Alpha/ });
	const beta = () => screen.getByRole("button", { name: /Beta/ });
	await user.keyboard("x");
	expect(screen.queryByText("1 selected")).toBeNull();
	beta().focus();
	await user.keyboard("j");
	expect(alpha()).toHaveFocus();
	await user.keyboard("j");
	expect(alpha()).toHaveFocus();
	await user.keyboard("k");
	expect(beta()).toHaveFocus();
	await user.keyboard("x");
	expect(screen.getByRole("checkbox", { name: "Select Beta at Globex" })).toHaveAttribute("aria-checked", "true");
	await user.keyboard("2");
	expect(mocks.moveWithUndo).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({ applications: [second], lane: expect.objectContaining({ systemKey: "applied" }) }),
	);
	view.update([first, { ...second, status: "applied" }]);
	expect(beta()).toHaveFocus();
	await user.keyboard("f");
	expect(mocks.logFollowUp).toHaveBeenCalledExactlyOnceWith({ id: "b" });
	await user.keyboard("{Enter}");
	expect(onOpen).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "b" }));
	view.update([first]);
	await user.keyboard("1");
	expect(mocks.moveWithUndo).toHaveBeenCalledTimes(1);
});

it("ignores repeated, composing and modified row commands and follows changed sorting/collapses", async () => {
	mocks.moveWithUndo.mockClear();
	mocks.logFollowUp.mockClear();
	const user = userEvent.setup();
	renderList([
		application({ id: "a", role: "Alpha" }),
		application({ id: "b", role: "Beta" }),
		application({ id: "c", role: "Gamma", status: "saved" }),
	]);
	await user.click(screen.getByRole("button", { name: "Role" }));
	const alpha = screen.getByRole("button", { name: /Alpha/ });
	alpha.focus();
	for (const extra of [
		{ repeat: true },
		{ isComposing: true },
		{ keyCode: 229 },
		{ ctrlKey: true },
		{ altKey: true },
		{ metaKey: true },
		{ shiftKey: true },
	]) {
		fireEvent.keyDown(alpha, { key: "4", code: "Digit4", ...extra });
		fireEvent.keyUp(alpha, { key: "4", code: "Digit4", ...extra });
	}
	expect(mocks.moveWithUndo).not.toHaveBeenCalled();
	await user.keyboard("j");
	expect(screen.getByRole("button", { name: /Beta/ })).toHaveFocus();
	await user.click(screen.getByRole("button", { name: "Saved 1" }));
	alpha.focus();
	await user.keyboard("jj");
	expect(screen.getByRole("button", { name: /Beta/ })).toHaveFocus();
	fireEvent.keyDown(screen.getByRole("button", { name: /Beta/ }), { key: "f", repeat: true });
	expect(mocks.logFollowUp).not.toHaveBeenCalled();
});
