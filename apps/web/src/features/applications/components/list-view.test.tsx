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
import { DEFAULT_LIST_COLUMNS, LIST_COLUMN_WIDTHS } from "@reactive-resume/schema/applications/layout";
import { ApplicationList } from "./list-view";

const mocks = vi.hoisted(() => ({ breakpoint: "desktop", invalidate: vi.fn(), setBuildStatus: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useRouteContext: () => ({ session: { user: { timezone: "UTC" } } }) }));
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
			bulkDelete: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
		},
	},
}));
vi.mock("../use-application-actions", () => ({
	useInvalidateApplications: () => mocks.invalidate,
	useApplicationActions: () => ({ setBuildStatus: mocks.setBuildStatus }),
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

function renderList(applications: ApplicationSummary[], breakpoint = "desktop", onOpen = vi.fn()) {
	mocks.breakpoint = breakpoint;
	i18n.load("en", {});
	i18n.activate("en");
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<I18nProvider i18n={i18n}>
				<ApplicationList
					applications={applications}
					stages={APPLICATION_STATUSES}
					sort={DEFAULT_APPLICATION_SORT}
					onSortChange={vi.fn()}
					columns={COLUMNS}
					onColumnResize={vi.fn()}
					selectedId={null}
					onOpen={onOpen}
				/>
			</I18nProvider>
		</QueryClientProvider>,
	);
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
	expect(screen.getByText(`Globex · ${LONG_NOTE}`)).toBeTruthy();
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
