// @vitest-environment happy-dom

import type { RouterOutput } from "@/libs/orpc/client";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContactDetails, DeleteAction } from "./details";
import { ConfirmDialogProvider } from "@/hooks/use-confirm";

type Contact = RouterOutput["directory"]["contact"]["contact"];

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
});
afterEach(cleanup);

type WrapperProps = { children: ReactNode };
function Wrapper({ children }: WrapperProps) {
	const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
	return (
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={queryClient}>
				<ConfirmDialogProvider>{children}</ConfirmDialogProvider>
			</QueryClientProvider>
		</I18nProvider>
	);
}

const renderDelete = (onDelete: () => Promise<unknown>) =>
	render(
		<DeleteAction
			label="Delete contact"
			title="Delete “Avery Morgan”?"
			description="Their notes and company history go with them."
			keep="Keep contact"
			onDelete={onDelete}
		/>,
		{ wrapper: Wrapper },
	);

describe("DeleteAction", () => {
	it("asks in a dialog and deletes nothing until it's confirmed", async () => {
		const onDelete = vi.fn(() => Promise.resolve());
		renderDelete(onDelete);

		fireEvent.click(screen.getByRole("button", { name: "Delete contact" }));
		const dialog = await screen.findByRole("alertdialog");
		expect(within(dialog).getByText("Delete “Avery Morgan”?")).toBeTruthy();
		expect(within(dialog).getByText("Their notes and company history go with them.")).toBeTruthy();
		expect(onDelete).not.toHaveBeenCalled();
		// The inline two-step sentence is gone.
		expect(screen.queryByText("This permanently deletes the selected records.")).toBeNull();

		await act(() => fireEvent.click(within(dialog).getByRole("button", { name: "Delete contact" })));
		await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
	});

	it("deletes nothing when Keep is chosen", async () => {
		const onDelete = vi.fn(() => Promise.resolve());
		renderDelete(onDelete);

		fireEvent.click(screen.getByRole("button", { name: "Delete contact" }));
		const dialog = await screen.findByRole("alertdialog");
		await act(() => fireEvent.click(within(dialog).getByRole("button", { name: "Keep contact" })));

		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		expect(onDelete).not.toHaveBeenCalled();
	});

	it("shows a failed delete's error under the button", async () => {
		const onDelete = vi.fn(() => Promise.reject(new Error("Contact not found.")));
		renderDelete(onDelete);

		fireEvent.click(screen.getByRole("button", { name: "Delete contact" }));
		const dialog = await screen.findByRole("alertdialog");
		await act(() => fireEvent.click(within(dialog).getByRole("button", { name: "Delete contact" })));

		expect((await screen.findByRole("alert")).textContent).toBe("Contact not found.");
		expect(screen.getByRole("button", { name: "Delete contact" })).toBeTruthy();
	});
});

const contact = (overrides: Partial<Contact> = {}) =>
	({
		id: "c1",
		name: "Avery Morgan",
		firstName: "Avery",
		lastName: "Morgan",
		companyId: null,
		position: "Recruiter",
		profileLinks: [],
		emails: [],
		phones: [],
		tags: [],
		notes: "",
		relationship: "",
		connectedOn: null,
		lastContactedAt: null,
		lookingForWork: false,
		sources: [],
		lastImportedAt: null,
		...overrides,
	}) as Contact;

/** The `<dl>`'s rows as [label, value text]. */
const rows = (container: HTMLElement) =>
	[...container.querySelectorAll("dl > div")].map((row) => [
		row.querySelector("dt")?.textContent,
		row.querySelector("dd")?.textContent,
	]);

describe("ContactDetails", () => {
	it("labels every detail with the Edit contact form's field names", () => {
		const { container } = render(
			<ContactDetails
				contact={contact({
					profileLinks: ["https://www.linkedin.com/in/avery-morgan"],
					emails: ["avery@example.com", "avery.morgan@example.org"],
					phones: ["+1 555 0100"],
					tags: ["Recruiter", "Fintech"],
					relationship: "Met at a meetup",
					notes: "Prefers email",
					connectedOn: "2024-03-01",
					lastContactedAt: new Date("2026-10-02T12:00:00.000Z"),
				})}
			/>,
			{ wrapper: Wrapper },
		);

		expect(rows(container)).toEqual([
			["Profile links", "https://www.linkedin.com/in/avery-morgan"],
			["Email addresses", "avery@example.comavery.morgan@example.org"],
			["Phone numbers", "+1 555 0100"],
			["Tags", "Recruiter · Fintech"],
			["How you know them", "Met at a meetup"],
			["Notes", "Prefers email"],
			["Connected on", "2024-03-01"],
			["Last contacted", "2026-10-02"],
		]);
		// Several values stay links, one per line.
		expect(screen.getByRole("link", { name: "avery.morgan@example.org" }).getAttribute("href")).toBe(
			"mailto:avery.morgan@example.org",
		);
		expect(screen.getByRole("link", { name: "+1 555 0100" }).getAttribute("href")).toBe("tel:+1 555 0100");
	});

	it("leaves empty details out and says when the last contact isn't recorded", () => {
		const { container } = render(<ContactDetails contact={contact()} />, { wrapper: Wrapper });
		expect(rows(container)).toEqual([["Last contacted", "Not recorded"]]);
	});
});
