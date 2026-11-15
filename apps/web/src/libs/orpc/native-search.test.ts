import { beforeEach, expect, it, vi } from "vite-plus/test";
import { nativeSearchContext } from "./native-search";

const provider = {
	id: "provider-a",
	recipientVersion: "recipient-a",
	provider: "openai",
	baseURL: "",
	enabled: true,
	testStatus: "success",
	managed: false,
};
const api = {
	ai: { capabilities: vi.fn() },
	aiProviders: { list: vi.fn() },
	agent: { threads: { get: vi.fn() } },
};
const searchApi = api as unknown as Parameters<typeof nativeSearchContext>[2];

beforeEach(() => {
	vi.clearAllMocks();
	api.ai.capabilities.mockResolvedValue({ nativeWebSearch: 1 });
	api.aiProviders.list.mockResolvedValue([provider]);
	api.agent.threads.get.mockResolvedValue({ thread: { aiProviderId: "provider-a" } });
});

it("asks nothing and adds nothing to ordinary AI requests", async () => {
	expect(await nativeSearchContext(["ai", "improve"], { line: "Fictional text" }, searchApi)).toBeUndefined();
	expect(await nativeSearchContext(["coverLetters", "draft"], {}, searchApi)).toBeUndefined();
	expect(api.aiProviders.list).not.toHaveBeenCalled();
});

it("names the chosen connection on an explicit native search retry", async () => {
	expect(
		await nativeSearchContext(["applications", "ai", "searchPostings"], { aiProviderId: "provider-a" }, searchApi),
	).toEqual({ aiDestination: JSON.stringify(["provider-a", "recipient-a"]), nativeSearchFallback: true });
	// A search without a chosen connection goes to the web service only.
	expect(
		await nativeSearchContext(["applications", "ai", "searchPostings"], { query: "x" }, searchApi),
	).toBeUndefined();
});

it("lets a chat with web research fall back to its own connection's search, and not when web research is off", async () => {
	expect(
		await nativeSearchContext(["agent", "messages", "send"], { threadId: "t1", context: { web: true } }, searchApi),
	).toEqual({ aiDestination: JSON.stringify(["provider-a", "recipient-a"]), nativeSearchFallback: true });
	expect(
		await nativeSearchContext(["agent", "messages", "send"], { threadId: "t1", context: { web: false } }, searchApi),
	).toBeUndefined();
});

it("adds nothing when the server or the connection can't search natively", async () => {
	api.ai.capabilities.mockResolvedValue({ nativeWebSearch: 0 });
	expect(
		await nativeSearchContext(["applications", "ai", "searchPostings"], { aiProviderId: "provider-a" }, searchApi),
	).toBeUndefined();
	api.ai.capabilities.mockResolvedValue({ nativeWebSearch: 1 });
	api.aiProviders.list.mockResolvedValue([{ ...provider, provider: "openai-compatible" }]);
	expect(
		await nativeSearchContext(["applications", "ai", "searchPostings"], { aiProviderId: "provider-a" }, searchApi),
	).toBeUndefined();
});
