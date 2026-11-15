// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { DownloadTab } from "./download-tab";

const mocks = vi.hoisted(() => ({ generate: vi.fn(), download: vi.fn(), toast: vi.fn() }));
vi.mock("@/features/resume/builder/draft", () => ({ useCurrentResume: () => ({ id: "resume" }) }));
vi.mock("@/features/resume/editor/check/use-check", () => ({ useOpenIssueCount: () => 0 }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }) }));
vi.mock("@/features/applications/queries", () => ({ applicationsListQueryOptions: () => ({}) }));
vi.mock("@/features/letters/export", () => ({ createLetterFile: vi.fn(), letterFileName: vi.fn() }));
vi.mock("@/libs/orpc/client", () => ({ client: {} }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: mocks.toast } }));
vi.mock("@reactive-resume/utils/file", () => ({ downloadWithAnchor: mocks.download }));
vi.mock("@/features/resume/export/use-resume-export", () => ({
	createExportFile: mocks.generate,
	getDefaultFileName: () => "resume",
	preloadDocumentExport: () => undefined,
	sanitizeFileName: (value: string) => value,
}));

// The fork strips upstream's community and donation asks: a finished download shows neither.
it("downloads without a Discord invite or donation ask, and falls back to PDF after a failure", async () => {
	i18n.load("en", {});
	i18n.activate("en");
	const file = new Blob(["fictional resume"]);
	let finish!: (file: Blob) => void;
	mocks.generate.mockReturnValueOnce(new Promise<Blob>((resolve) => (finish = resolve)));
	render(
		<I18nProvider i18n={i18n}>
			<DownloadTab onReview={() => undefined} />
		</I18nProvider>,
	);
	const invite = () => screen.queryByRole("link", { name: "Get resume feedback on Discord" });
	expect(invite()).toBeNull();
	expect(screen.queryByRole("link", { name: "Donate" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
	expect(invite()).toBeNull();
	expect(screen.queryByRole("link", { name: "Donate" })).toBeNull();
	finish(file);
	await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledWith(file, "resume.pdf"));
	expect(screen.queryByRole("link", { name: "Get resume feedback on Discord" })).toBeNull();
	expect(screen.queryByRole("link", { name: "Donate" })).toBeNull();
	expect(document.body.innerHTML).not.toMatch(/discord|opencollective/i);

	fireEvent.click(screen.getByRole("radio", { name: /Word/ }));
	expect(invite()).toBeNull();
	expect(screen.queryByRole("link", { name: "Donate" })).toBeNull();
	mocks.generate.mockRejectedValueOnce(new Error("Export unavailable"));
	fireEvent.click(screen.getByRole("button", { name: "Download Word" }));
	await screen.findByRole("alert");
	expect(invite()).toBeNull();
	expect(screen.queryByRole("link", { name: "Donate" })).toBeNull();
	expect(mocks.download).toHaveBeenCalledTimes(1);
	mocks.generate.mockResolvedValueOnce(file);
	fireEvent.click(screen.getByRole("button", { name: "Download PDF instead" }));
	await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(2));
});
