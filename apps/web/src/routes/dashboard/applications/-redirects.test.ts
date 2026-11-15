import { expect, it, vi } from "vite-plus/test";
import { isRedirect } from "@tanstack/react-router";
import { Route } from "./index";

// The page isn't under test: only where the old one-application address is sent.
vi.mock("@/features/applications/components/add-application-dialog", () => ({ AddApplicationDialog: () => null }));
vi.mock("@/features/applications/components/board", () => ({ ApplicationBoard: () => null }));
vi.mock("@/features/applications/components/calendar-view", () => ({ ApplicationCalendar: () => null }));
vi.mock("@/features/applications/components/export-applications-sheet", () => ({
	ExportApplicationsSheet: () => null,
}));
vi.mock("@/features/applications/components/import-applications-sheet", () => ({
	ImportApplicationsSheet: () => null,
}));
vi.mock("@/features/applications/components/insights-view", () => ({
	ApplicationInsights: () => null,
	InsightsSkeleton: () => null,
}));
vi.mock("@/features/applications/components/list-view", () => ({ ApplicationList: () => null }));
vi.mock("@/features/applications/components/manage-lanes-sheet", () => ({ ManageLanesSheet: () => null }));
vi.mock("@/components/layout/phone-header-actions", () => ({ PhoneHeaderActions: () => null }));
vi.mock("@/features/career/shared", () => ({ useCareerTime: () => ({}), useNow: () => new Date() }));

type RouteOptions = {
	validateSearch: { parse: (search: unknown) => unknown };
	beforeLoad?: (context: never) => unknown;
};

async function destination(search: Record<string, unknown>) {
	const { options } = Route as unknown as { options: RouteOptions };
	try {
		options.beforeLoad?.({ search: options.validateSearch.parse(search) } as never);
	} catch (thrown) {
		if (!isRedirect(thrown)) throw thrown;
		const { to, params, search, replace } = thrown.options;
		return { to, params, search, replace };
	}
	return null;
}

// Upstream sends ?applicationId to the application's page; the fork opens the details sheet on the list instead.
it("keeps the one-application address on the list, where it opens the details sheet", async () => {
	expect(await destination({ applicationId: "app-1", view: "board" })).toBeNull();
});

it("keeps the list where no application is named", async () => {
	expect(await destination({ view: "calendar", closed: true })).toBeNull();
});
