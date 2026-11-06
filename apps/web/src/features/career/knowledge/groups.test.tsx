// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({ groups: [] as unknown[], setStatus: vi.fn(), savePrivacy: vi.fn() }));
const toasts = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("@/libs/orpc/client", () => {
	const endpoint = (name: string) => ({
		key: () => [name],
		queryOptions: () => ({ queryKey: [name], queryFn: async () => api.groups, retry: false }),
		mutationOptions: () => ({ mutationFn: name === "saveFactGroup" ? api.savePrivacy : api.setStatus }),
	});
	return {
		orpc: {
			career: {
				factGroups: endpoint("factGroups"),
				setFactGroupStatus: endpoint("setFactGroupStatus"),
				saveFactGroup: endpoint("saveFactGroup"),
				facts: endpoint("facts"),
				stories: endpoint("stories"),
			},
		},
	};
});
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: toasts }));

i18n.loadAndActivate({ locale: "en", messages: {} });
const { GroupsCard, groupMeta, groupTree } = await import("./groups");
const number = new Intl.NumberFormat("en");

const entry = (
	group: string | null,
	active: number,
	excluded: number,
	status: "active" | "excluded" | null = null,
	isPrivate = false,
) => ({
	group,
	status,
	private: isPrivate,
	facts: { active, excluded, archived: 0 },
	activeChars: active * 100,
});

describe("groupTree", () => {
	it("adds parents with no facts of their own and counts subgroups in", () => {
		const tree = groupTree([
			entry("experience/acme", 2, 1),
			entry("experience/globex", 1, 0, "active"),
			entry("clearance", 0, 18, "excluded"),
			entry(null, 5, 0),
		]);
		expect(tree.map((node) => [node.path, node.depth])).toEqual([
			["clearance", 0],
			["experience", 0],
			["experience/acme", 1],
			["experience/globex", 1],
		]);
		expect(tree.find((node) => node.path === "experience")).toMatchObject({
			facts: { active: 3, excluded: 1 },
			activeChars: 300,
			status: null,
		});
		expect(tree[0]).toMatchObject({ name: "clearance", status: "excluded" });
	});

	it("keeps a parent's subgroups right under it", () => {
		expect(groupTree([entry("a b", 1, 0), entry("a/b", 1, 0)]).map((node) => node.path)).toEqual(["a", "a/b", "a b"]);
	});

	it("gives each group the setting it inherits and its nearest private parent", () => {
		const tree = groupTree([
			entry("experience/pre-2017/initech", 0, 2),
			entry("experience/pre-2017", 0, 13, "excluded"),
			entry("experience/globex", 4, 0),
			entry("clearance", 0, 6, null, true),
			entry("clearance/renewals/old", 0, 1),
			entry("clearance/renewals", 0, 1, null, true),
		]);
		const node = (path: string) => tree.find((each) => each.path === path);
		expect(node("experience")).toMatchObject({ startsAs: "active", privateThrough: null, privateFromParent: false });
		expect(node("experience/pre-2017")).toMatchObject({ startsAs: "excluded" });
		expect(node("experience/pre-2017/initech")).toMatchObject({ status: null, startsAs: "excluded" });
		expect(node("experience/globex")).toMatchObject({ startsAs: "active" });
		expect(node("clearance")).toMatchObject({ private: true, privateThrough: null, privateFromParent: false });
		// The nearest private group above it, not the topmost.
		expect(node("clearance/renewals/old")).toMatchObject({
			privateThrough: "clearance/renewals",
			privateFromParent: true,
		});
		expect(node("clearance/renewals")).toMatchObject({ private: true, privateThrough: "clearance" });
	});
});

describe("groupMeta", () => {
	const meta = (...groups: ReturnType<typeof entry>[]) => {
		const tree = groupTree(groups);
		return (path: string) => {
			const node = tree.find((each) => each.path === path);
			if (!node) throw new Error(`no group ${path}`);
			return groupMeta(node, number);
		};
	};

	it("counts facts when they're all on or all off, and splits them when mixed", () => {
		const of = meta(entry("on", 26, 0), entry("one", 1, 0), entry("off", 0, 15, "excluded"), entry("mixed", 52, 15));
		expect(of("on")).toBe("26 facts · 2,600 characters");
		expect(of("one")).toBe("1 fact · 100 characters");
		expect(of("off")).toBe("15 facts · nothing sent");
		expect(of("mixed")).toBe("52 on · 15 off · 5,200 characters");
	});

	it("says when a group has no facts", () => {
		expect(meta(entry("empty", 0, 0, "excluded"))("empty")).toBe("No facts · nothing sent");
	});

	it("says private, or which parent makes it private, instead of what it adds", () => {
		const of = meta(entry("clearance", 0, 6, null, true), entry("clearance/renewals", 0, 2));
		expect(of("clearance")).toBe("8 facts · private");
		expect(of("clearance/renewals")).toBe("2 facts · private through clearance");
	});
});

/** A row's line under its name, matched whole: the default's on/off word is its own button inside it. */
const metaLine = (text: string) => (_: string, element: Element | null) =>
	element?.tagName === "P" && element.textContent === text;

const renderCard = () =>
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient()}>
				<GroupsCard />
			</QueryClientProvider>
		</I18nProvider>,
	);

describe("GroupsCard", () => {
	beforeEach(() => {
		api.setStatus.mockReset().mockResolvedValue({ updated: 3 });
		api.groups = [
			entry("experience/acme", 2, 1),
			entry("clearance", 0, 18, "excluded"),
			entry("empty", 0, 0, "excluded"),
			entry(null, 4, 1),
		];
	});
	afterEach(cleanup);

	it("shows one switch per group, on when anything in it is on, and switches it with its subgroups", async () => {
		renderCard();
		expect(await screen.findByText(metaLine("18 facts · nothing sent · new facts default: off"))).toBeTruthy();
		expect(screen.getByText("Not in a group: 4 on · 1 off")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Switch .* (on|off)/ })).toBeNull();

		const experience = screen.getByRole("switch", { name: "Switch experience on" });
		expect(experience.getAttribute("aria-checked")).toBe("true");
		expect(screen.getByRole("switch", { name: "Switch clearance on" }).getAttribute("aria-checked")).toBe("false");
		// Nothing to switch in a group with no facts.
		expect(screen.getByRole("switch", { name: "Switch empty on" }).getAttribute("aria-disabled")).toBe("true");

		fireEvent.click(experience);
		await waitFor(() => expect(api.setStatus).toHaveBeenCalled());
		expect(api.setStatus.mock.calls[0]?.[0]).toEqual({ group: "experience", status: "excluded", subgroups: true });

		fireEvent.click(screen.getByRole("switch", { name: "Switch clearance on" }));
		await waitFor(() => expect(api.setStatus).toHaveBeenCalledTimes(2));
		expect(api.setStatus.mock.calls[1]?.[0]).toEqual({ group: "clearance", status: "active", subgroups: true });
	});
});

describe("private groups", () => {
	beforeEach(() => {
		api.savePrivacy.mockReset().mockResolvedValue({});
		api.groups = [entry("clearance", 1, 17, "excluded", true), entry("clearance/ts", 0, 1), entry("experience", 3, 0)];
	});
	afterEach(cleanup);

	it("locks a group, and shows its subgroups locked by it", async () => {
		renderCard();
		const parent = await screen.findByRole("button", { name: "Keep clearance private" });
		expect(parent.getAttribute("aria-pressed")).toBe("true");
		expect(parent.getAttribute("aria-disabled")).not.toBe("true");
		const subgroup = screen.getByRole("button", { name: "Keep clearance/ts private" });
		expect(subgroup.getAttribute("aria-pressed")).toBe("true");
		expect(subgroup.getAttribute("aria-disabled")).toBe("true");
		expect(screen.getByText(metaLine("1 fact · private through clearance · new facts default: off"))).toBeTruthy();
		const open = screen.getByRole("button", { name: "Keep experience private" });
		expect(open.getAttribute("aria-pressed")).toBe("false");

		fireEvent.click(subgroup);
		fireEvent.click(open);
		await waitFor(() => expect(api.savePrivacy).toHaveBeenCalled());
		expect(api.savePrivacy.mock.calls).toEqual([[{ group: "experience", private: true }, expect.anything()]]);

		fireEvent.click(parent);
		await waitFor(() => expect(api.savePrivacy).toHaveBeenCalledTimes(2));
		expect(api.savePrivacy.mock.calls[1]?.[0]).toEqual({ group: "clearance", private: false });
	});
});

describe("new facts default", () => {
	beforeEach(() => {
		api.setStatus.mockReset().mockResolvedValue({ updated: 0 });
		api.savePrivacy.mockReset().mockResolvedValue({ group: "x", private: false, status: null });
		toasts.add.mockReset();
		api.groups = [
			entry("experience", 52, 0),
			entry("experience/pre-2017", 0, 13, "excluded"),
			entry("experience/pre-2017/initech", 0, 2),
			entry("clearance", 0, 6, null, true),
			entry("clearance/renewals", 0, 2),
		];
	});
	afterEach(cleanup);

	const defaultOf = (path: string, value: "on" | "off") =>
		screen.getByRole("button", { name: `New facts in ${path} default to ${value}` });

	it("shows on every row, inherited from the nearest parent, green for on and red for off", async () => {
		renderCard();
		expect(await screen.findByText(metaLine("52 on · 15 off · 5,200 characters · new facts default: on"))).toBeTruthy();
		expect(screen.getByText(metaLine("15 facts · nothing sent · new facts default: off"))).toBeTruthy();
		// No setting of its own: it takes its parent's, and says so even though it matches the switch.
		expect(screen.getByText(metaLine("2 facts · nothing sent · new facts default: off"))).toBeTruthy();
		expect(screen.getByText(metaLine("8 facts · private · new facts default: on"))).toBeTruthy();
		expect(screen.getByText(metaLine("2 facts · private through clearance · new facts default: on"))).toBeTruthy();

		const on = defaultOf("experience", "on");
		expect(on.textContent).toBe("on");
		expect(on.className).toContain("text-success-text");
		const off = defaultOf("experience/pre-2017/initech", "off");
		expect(off.textContent).toBe("off");
		expect(off.className).toContain("text-danger-text");
	});

	it("flips only the group's own default, without switching its facts, private groups included", async () => {
		renderCard();
		fireEvent.click(await screen.findByRole("button", { name: "New facts in experience default to on" }));
		await waitFor(() => expect(api.savePrivacy).toHaveBeenCalled());
		expect(api.savePrivacy.mock.calls[0]?.[0]).toEqual({ group: "experience", status: "excluded" });
		await waitFor(() =>
			expect(toasts.add).toHaveBeenCalledWith({
				type: "success",
				description: "New facts in experience now start off.",
			}),
		);

		fireEvent.click(defaultOf("experience/pre-2017/initech", "off"));
		await waitFor(() => expect(api.savePrivacy).toHaveBeenCalledTimes(2));
		expect(api.savePrivacy.mock.calls[1]?.[0]).toEqual({ group: "experience/pre-2017/initech", status: "active" });

		// Still clickable through a private parent: the default matters when an application includes the group.
		const renewals = defaultOf("clearance/renewals", "on");
		expect(renewals.hasAttribute("disabled")).toBe(false);
		fireEvent.click(renewals);
		await waitFor(() => expect(api.savePrivacy).toHaveBeenCalledTimes(3));
		expect(api.savePrivacy.mock.calls[2]?.[0]).toEqual({ group: "clearance/renewals", status: "excluded" });

		expect(api.setStatus).not.toHaveBeenCalled();
	});
});
