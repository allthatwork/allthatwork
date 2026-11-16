// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { DEFAULT_APPLICATION_FILTERS, DEFAULT_APPLICATION_SORT } from "@reactive-resume/schema/applications/filters";
import { SaveViewDialog } from "./save-view-dialog";

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
});
afterEach(cleanup);

const renderDialog = (onOpenChange: (open: boolean) => void) =>
	render(
		<I18nProvider i18n={i18n}>
			<SaveViewDialog
				open
				onOpenChange={onOpenChange}
				filters={DEFAULT_APPLICATION_FILTERS}
				sort={DEFAULT_APPLICATION_SORT}
				columns={[]}
				noReplyDays={14}
				onSave={() => Promise.resolve()}
				existingName={(name) => name}
			/>
		</I18nProvider>,
	);

describe("SaveViewDialog", () => {
	it("has the standard close button beside Cancel and Save view", async () => {
		const onOpenChange = vi.fn();
		renderDialog(onOpenChange);

		const close = await screen.findByRole("button", { name: "Close" });
		expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Save view" })).toBeTruthy();

		await act(() => fireEvent.click(close));
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything()));
	});
});
