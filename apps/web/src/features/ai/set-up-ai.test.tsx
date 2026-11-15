// @vitest-environment happy-dom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: unknown }) => children }));
vi.mock("@/libs/orpc/client", () => ({
	client: { aiProviders: { create: vi.fn(), update: vi.fn(), test: vi.fn() } },
	orpc: { aiProviders: { list: { key: () => ["aiProviders"] } } },
}));
// No saved connections yet.
vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({
		isUnavailable: false,
		providers: [],
		usableProviders: [],
		hasUsableProvider: false,
	}),
}));
vi.mock("@/features/settings/ai/next-steps", () => ({ TryItOn: () => null }));

i18n.loadAndActivate({ locale: "en", messages: {} });

const { SetUpAiDialog } = await import("./set-up-ai");

const entry = (id: string, release_date: string) => ({
	id,
	name: id,
	release_date,
	modalities: { input: ["text"], output: ["text"] },
	limit: { context: 128000, output: 8192 },
});

function renderSetup() {
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient()}>
				<SetUpAiDialog open onOpenChange={() => {}} />
			</QueryClientProvider>
		</I18nProvider>,
	);
}

const modelInput = () => screen.getByLabelText("Model") as HTMLInputElement;

describe("Set up AI", () => {
	afterEach(() => vi.restoreAllMocks());

	it("suggests the newest models.dev model without filling the box", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json({
				openai: { models: { old: entry("gpt-old", "2025-04-14"), new: entry("gpt-new", "2026-09-29") } },
			}),
		);
		renderSetup();

		await waitFor(() => expect(modelInput().placeholder).toBe("gpt-new"));
		expect(modelInput().value).toBe("");
	});

	it("leaves the model blank when models.dev doesn't load", async () => {
		const fetchCatalog = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Unavailable", { status: 503 }));
		renderSetup();

		await waitFor(() => expect(fetchCatalog).toHaveBeenCalled());
		expect(modelInput().value).toBe("");
		expect(modelInput().placeholder).toBe("");
	});

	it("doesn't promise a consent prompt the fork removed", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Unavailable", { status: 503 }));
		renderSetup();
		await waitFor(() => expect(modelInput()).toBeTruthy());
		expect(document.body.textContent).not.toMatch(/asks before/);
	});
});
