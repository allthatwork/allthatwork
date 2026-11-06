// @vitest-environment happy-dom

import type { RouterOutput } from "@/libs/orpc/client";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Company = RouterOutput["directory"]["companies"][number];
type ToastOptions = { title?: string; description?: string; actionProps?: { onClick: () => void } };

const api = vi.hoisted(() => ({
	watch: vi.fn(),
	unwatch: vi.fn(),
	navigate: vi.fn(),
	toasts: [] as { type?: string; title?: string; description?: string; actionProps?: { onClick: () => void } }[],
}));

vi.mock("@/libs/orpc/client", () => ({
	client: { boards: { watch: api.watch, unwatch: api.unwatch } },
	orpc: { directory: { companies: { queryKey: () => ["directory", "companies"] } } },
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({
	toast: {
		add: (options: ToastOptions) => {
			api.toasts.push(options);
			return "toast";
		},
		close: vi.fn(),
	},
}));
vi.mock("@tanstack/react-router", () => ({
	// A stand-in for the router's Link: the click is what's checked.
	Link: ({ children, className }: { children: ReactNode; className?: string }) => (
		<a
			href="/dashboard/directory"
			className={className}
			onClick={(event) => {
				event.preventDefault();
				api.navigate();
			}}
		>
			{children}
		</a>
	),
}));

i18n.loadAndActivate({ locale: "en", messages: {} });

const { CompanyRow } = await import("./lists");
const { jobsLink, watchState } = await import("./watch");

const greenhouse = { ats: "greenhouse" as const, region: "us" as const, slug: "halcyon" };
const WATCHED = {
	id: "w1",
	...greenhouse,
	source: "posting" as const,
	url: "https://job-boards.greenhouse.io/halcyon",
	jobCount: 143,
};
const FOUND = {
	ats: "ashby" as const,
	region: "us" as const,
	slug: "heliotrope",
	url: "https://jobs.ashbyhq.com/heliotrope",
};
const WORKDAY = "https://lumenfreight.wd5.myworkdayjobs.com/careers";

const company = (overrides: Partial<Company>): Company => ({
	id: "c1",
	name: "Heliotrope",
	normalizedKey: "heliotrope",
	website: null,
	careersUrl: null,
	notes: "",
	sources: [],
	createdAt: new Date("2026-11-01"),
	updatedAt: new Date("2026-11-01"),
	contactCount: 0,
	applicationCount: 1,
	jobs: { watching: [], found: null },
	...overrides,
});

let queryClient: QueryClient;
function renderRow(row: Company) {
	queryClient = new QueryClient();
	queryClient.setQueryData(["directory", "companies"], [row]);
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={queryClient}>
				<CompanyRow company={row} />
			</QueryClientProvider>
		</I18nProvider>,
	);
	return screen.getByRole("checkbox", { name: `Watch ${row.name}` });
}
const cached = () => (queryClient.getQueryData(["directory", "companies"]) as Company[])[0];
/** Moves a mouse onto an element, as a tooltip's trigger expects. */
function hover(element: HTMLElement) {
	fireEvent.pointerEnter(element, { pointerType: "mouse" });
	fireEvent.pointerMove(element, { pointerType: "mouse" });
	fireEvent.mouseEnter(element);
	fireEvent.mouseMove(element);
}
/** The desktop Jobs ↗ button (the phone line has its own link). */
const jobsButtons = () => screen.getAllByRole("button", { name: "Jobs ↗" });

beforeEach(() => {
	vi.clearAllMocks();
	api.toasts.length = 0;
	api.watch.mockResolvedValue({ id: "w-new", added: 2 });
	api.unwatch.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("jobsLink and watchState", () => {
	it("prefers the watched page, then the found one, then the saved link", () => {
		const both = { jobs: { watching: [WATCHED], found: { ...FOUND, jobCount: 38 } }, careersUrl: null };
		expect(jobsLink(both)).toEqual({ url: WATCHED.url, count: 143 });
		expect(watchState(both)).toBe("watched");
		const found = { jobs: { watching: [], found: { ...FOUND, jobCount: null } }, careersUrl: WORKDAY };
		expect(jobsLink(found)).toEqual({ url: FOUND.url, count: null });
		expect(watchState(found)).toBe("found");
		const saved = { jobs: { watching: [], found: null }, careersUrl: WORKDAY };
		expect(jobsLink(saved)).toEqual({ url: WORKDAY, count: null });
		expect(watchState(saved)).toBe("saved");
		const none = { jobs: { watching: [], found: null }, careersUrl: null };
		expect(jobsLink(none)).toBeNull();
		expect(watchState(none)).toBe("none");
	});

	it("uses the first watched page's count and link when old data has more than one", () => {
		const second = { ...WATCHED, id: "w2", slug: "halcyon-eu", url: "https://jobs.lever.co/halcyon-eu", jobCount: 4 };
		expect(jobsLink({ jobs: { watching: [WATCHED, second], found: null }, careersUrl: null })).toEqual({
			url: WATCHED.url,
			count: 143,
		});
	});
});

describe("CompanyRow", () => {
	it("shows a watched company's open count and Jobs ↗, ticked", () => {
		const box = renderRow(company({ name: "Halcyon Health", jobs: { watching: [WATCHED], found: null } }));
		expect(box.getAttribute("aria-checked")).toBe("true");
		expect(box.hasAttribute("data-disabled")).toBe(false);
		expect(screen.getAllByText("143 open").length).toBeGreaterThan(0);
		expect(jobsButtons()[0]?.getAttribute("href")).toBe(WATCHED.url);
		expect(screen.queryByText(/Greenhouse/)).toBeNull();
	});

	it("shows a found page with its count, or without one, unticked and enabled", () => {
		const box = renderRow(company({ jobs: { watching: [], found: { ...FOUND, jobCount: 38 } } }));
		expect(box.getAttribute("aria-checked")).toBe("false");
		expect(box.hasAttribute("data-disabled")).toBe(false);
		expect(screen.getAllByText("38 open").length).toBeGreaterThan(0);
		expect(jobsButtons()[0]?.getAttribute("href")).toBe(FOUND.url);
		cleanup();
		renderRow(company({ jobs: { watching: [], found: { ...FOUND, jobCount: null } } }));
		expect(screen.queryByText(/open$/)).toBeNull();
		expect(jobsButtons()[0]?.getAttribute("href")).toBe(FOUND.url);
	});

	it("shows Jobs ↗ alone for a saved link, with the box disabled and why on hover", async () => {
		const box = renderRow(company({ name: "Lumen Freight", careersUrl: WORKDAY }));
		expect(box.hasAttribute("data-disabled")).toBe(true);
		expect(screen.queryByText(/open$/)).toBeNull();
		expect(jobsButtons()[0]?.getAttribute("href")).toBe(WORKDAY);
		hover(box.parentElement as HTMLElement);
		expect(
			await screen.findByText("Only Greenhouse, Ashby and Lever can be watched for now.", {}, { timeout: 3000 }),
		).toBeTruthy();
	});

	it("shows a dash when no page is known, with the box disabled and why on hover", async () => {
		const box = renderRow(company({ name: "Brightline" }));
		expect(box.hasAttribute("data-disabled")).toBe(true);
		expect(screen.getByText("—")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Jobs ↗" })).toBeNull();
		fireEvent.click(box);
		expect(api.watch).not.toHaveBeenCalled();
		hover(box.parentElement as HTMLElement);
		expect(
			await screen.findByText("No jobs page known yet. Open the company to look one up.", {}, { timeout: 3000 }),
		).toBeTruthy();
	});

	it("puts the open count and Jobs ↗ first on the phone line, then the counts without zeros", () => {
		renderRow(
			company({ contactCount: 0, applicationCount: 1, jobs: { watching: [], found: { ...FOUND, jobCount: 38 } } }),
		);
		const line = screen.getByText(
			(_, element) => element?.tagName === "SPAN" && !!element.className.includes("sm:hidden") && !!element.textContent,
		);
		expect(line.textContent).toBe("38 open · Jobs ↗ · 1 application");
		expect(within(line).getByRole("link", { name: "Jobs ↗" }).getAttribute("href")).toBe(FOUND.url);
	});

	it("holds a just-started watch, still without its id, until the refresh", () => {
		const box = renderRow(company({ jobs: { watching: [{ ...WATCHED, id: "" }], found: null } }));
		expect(box.getAttribute("aria-checked")).toBe("true");
		expect(box.hasAttribute("data-disabled")).toBe(true);
		fireEvent.click(box);
		expect(api.unwatch).not.toHaveBeenCalled();
	});

	it("ticking watches the found page at once, with a toast whose Undo stops it", async () => {
		const box = renderRow(company({ jobs: { watching: [], found: { ...FOUND, jobCount: 38 } } }));
		fireEvent.click(box);
		expect(api.watch).toHaveBeenCalledWith({
			companyId: "c1",
			ats: "ashby",
			region: "us",
			slug: "heliotrope",
			source: "posting",
		});
		await waitFor(() => expect(cached()?.jobs.watching).toHaveLength(1));
		// Until the refresh brings the new watch's id, it can't be unticked.
		expect(cached()?.jobs.watching[0]?.id).toBe("");
		expect(api.toasts.at(-1)).toMatchObject({
			title: "Watching Heliotrope",
			description: "Its new roles show up in Career → Today.",
		});
		api.toasts.at(-1)?.actionProps?.onClick();
		await waitFor(() => expect(cached()?.jobs.watching).toHaveLength(0));
		await waitFor(() => expect(api.unwatch).toHaveBeenCalledWith({ id: "w-new" }));
	});

	it("keeps the ticked box when a refetch was in flight", async () => {
		const row = company({ jobs: { watching: [], found: { ...FOUND, jobCount: 38 } } });
		const box = renderRow(row);
		// A slow refetch of the list (as right after the page loads), cancelled by ticking.
		void queryClient
			.fetchQuery({
				queryKey: ["directory", "companies"],
				queryFn: () => new Promise<Company[]>((resolve) => setTimeout(() => resolve([row]), 200)),
			})
			.catch(() => undefined);
		fireEvent.click(box);
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(cached()?.jobs.watching).toHaveLength(1);
	});

	it("rolls a failed watch back with an error", async () => {
		api.watch.mockRejectedValue(new Error("down"));
		const box = renderRow(company({ jobs: { watching: [], found: { ...FOUND, jobCount: 38 } } }));
		fireEvent.click(box);
		await waitFor(() => expect(api.toasts.at(-1)).toMatchObject({ type: "error" }));
		expect(cached()?.jobs).toMatchObject({ watching: [], found: { slug: "heliotrope" } });
	});

	it("unticking stops every watched page, with a toast whose Undo watches them again", async () => {
		const second = { ...WATCHED, id: "w2", ats: "lever" as const, slug: "halcyon-eu", source: "link" as const };
		const box = renderRow(company({ name: "Halcyon Health", jobs: { watching: [WATCHED, second], found: null } }));
		fireEvent.click(box);
		expect(api.unwatch).toHaveBeenCalledWith({ id: "w1" });
		expect(api.unwatch).toHaveBeenCalledWith({ id: "w2" });
		await waitFor(() => expect(cached()?.jobs.watching).toHaveLength(0));
		expect(api.toasts.at(-1)).toMatchObject({ title: "Stopped watching Halcyon Health" });
		api.toasts.at(-1)?.actionProps?.onClick();
		await waitFor(() => expect(api.watch).toHaveBeenCalledTimes(2));
		expect(api.watch).toHaveBeenCalledWith({ companyId: "c1", ...greenhouse, source: "posting" });
		expect(api.watch).toHaveBeenCalledWith({
			companyId: "c1",
			ats: "lever",
			region: "us",
			slug: "halcyon-eu",
			source: "link",
		});
	});

	it("doesn't open the company from the box or Jobs ↗, but does from the rest of the row", () => {
		const box = renderRow(company({ jobs: { watching: [], found: { ...FOUND, jobCount: 38 } } }));
		fireEvent.click(box);
		fireEvent.click(jobsButtons()[0] as HTMLElement);
		expect(api.navigate).not.toHaveBeenCalled();
		fireEvent.click(screen.getByText("Heliotrope"));
		expect(api.navigate).toHaveBeenCalledTimes(1);
	});

	it("works from the keyboard", () => {
		const box = renderRow(company({ jobs: { watching: [], found: { ...FOUND, jobCount: 38 } } }));
		box.focus();
		expect(document.activeElement).toBe(box);
		fireEvent.keyDown(box, { key: " " });
		fireEvent.keyUp(box, { key: " " });
		expect(api.watch).toHaveBeenCalledTimes(1);
	});
});
