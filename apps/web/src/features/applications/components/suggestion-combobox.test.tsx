// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { SuggestionCombobox } from "./suggestion-combobox";

function open(value: string | null, onChange = vi.fn()) {
	i18n.load("en", {});
	i18n.activate("en");
	render(
		<I18nProvider i18n={i18n}>
			<SuggestionCombobox value={value} suggestions={["Greenhouse", "Ashby", "LinkedIn"]} onChange={onChange} />
		</I18nProvider>,
	);
	fireEvent.click(screen.getByRole("combobox"));
	return onChange;
}

it("opens with every suggestion even when a value is set", async () => {
	open("Ashby");
	await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
	expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
		"Greenhouse",
		"Ashby",
		"LinkedIn",
	]);
});

it("keeps a value that isn't a suggestion in the list", async () => {
	open("Wellfound");
	await waitFor(() => expect(screen.getAllByRole("option").map((option) => option.textContent)).toContain("Wellfound"));
});

it("offers to add what was typed, and saves it", async () => {
	const onChange = open(null);
	fireEvent.change(await screen.findByPlaceholderText("Search or add…"), { target: { value: "Wellfound" } });
	const add = await screen.findByRole("option", { name: "Add “Wellfound”" });
	fireEvent.click(add);
	await waitFor(() => expect(onChange).toHaveBeenCalledWith("Wellfound"));
});

it("doesn't offer to add a suggestion typed in another case", async () => {
	open(null);
	fireEvent.change(await screen.findByPlaceholderText("Search or add…"), { target: { value: "ashby" } });
	await waitFor(() => expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Ashby"]));
});
