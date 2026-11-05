// @vitest-environment happy-dom
import type { TargetingBuildStatus } from "@reactive-resume/schema/applications/data";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { BuildStatusControl } from "./build-status";

const setBuildStatus = vi.hoisted(() => vi.fn());
vi.mock("../use-application-actions", () => ({
	useApplicationActions: () => ({ setBuildStatus }),
}));

beforeEach(() => {
	setBuildStatus.mockReset();
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});

afterEach(() => {
	cleanup();
});

const card = (targetingBuildStatus: TargetingBuildStatus | null) => ({
	id: "app-1",
	role: "Staff Engineer",
	company: "Cribl",
	targetingBuildStatus,
});

const mount = (targetingBuildStatus: TargetingBuildStatus | null, onParentClick = vi.fn()) =>
	render(
		<I18nProvider i18n={i18n}>
			{/* oxlint-disable-next-line jsx_a11y/click-events-have-key-events, jsx_a11y/no-static-element-interactions -- tests stopPropagation on parent card */}
			<div onClick={onParentClick}>
				<BuildStatusControl application={card(targetingBuildStatus)} />
			</div>
		</I18nProvider>,
	);

describe("BuildStatusControl", () => {
	it("queues a build when unchecked and stops click propagation", () => {
		const onParentClick = vi.fn();
		mount(null, onParentClick);
		const checkbox = screen.getByRole("checkbox", { name: "Build resume for Staff Engineer at Cribl" });
		expect(checkbox.getAttribute("aria-checked")).toBe("false");
		fireEvent.click(checkbox);
		expect(setBuildStatus).toHaveBeenCalledWith(expect.objectContaining({ id: "app-1" }), "build");
		expect(onParentClick).not.toHaveBeenCalled();
	});

	it("unqueues back to null when checked", () => {
		mount("build");
		const checkbox = screen.getByRole("checkbox", { name: "Build resume for Staff Engineer at Cribl" });
		expect(checkbox.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(checkbox);
		expect(setBuildStatus).toHaveBeenCalledWith(expect.objectContaining({ id: "app-1" }), null);
	});

	it.each([
		["building", "Building"],
		["built", "Built"],
		["failed", "Failed"],
	] as const)("renders %s as a read-only label without a checkbox", (status, label) => {
		mount(status);
		expect(screen.queryByRole("checkbox")).toBeNull();
		expect(screen.getByText(label)).toBeDefined();
	});
});
