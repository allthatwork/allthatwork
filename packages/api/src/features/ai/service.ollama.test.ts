import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { generateText } from "ai";

vi.mock("@reactive-resume/env/server", () => ({ env: { FLAG_ALLOW_UNSAFE_AI_BASE_URL: false } }));
// Each provider attempt records an AI usage row first; these tests read request bodies, not the ledger.
vi.mock("@reactive-resume/db/client", () => {
	const database = { insert: () => ({ values: async () => undefined }) };
	return { db: { ...database, transaction: async (run: (tx: typeof database) => Promise<void>) => run(database) } };
});
vi.mock("../ai-providers/identity", async (original) => ({
	...(await original<typeof import("../ai-providers/identity")>()),
	assertProviderAvailable: async () => undefined,
}));
vi.mock("../documents/ownership", async (original) => ({
	...(await original<typeof import("../documents/ownership")>()),
	lockUser: async () => undefined,
}));
// Provider requests still reach the stubbed global fetch; fetchPublic's own network checks are tested in utils.
vi.mock("@reactive-resume/utils/url-security.node", async (original) => ({
	...(await original<typeof import("@reactive-resume/utils/url-security.node")>()),
	fetchPublic: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
}));

afterEach(() => {
	vi.unstubAllGlobals();
});

/** Answers every Ollama chat call with "1" and keeps the request bodies. */
function stubOllama() {
	const bodies: Array<Record<string, unknown>> = [];
	vi.stubGlobal(
		"fetch",
		vi.fn((_input: unknown, init?: { body?: unknown }) => {
			bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
			return new Response(
				JSON.stringify({
					model: "llama3.1",
					created_at: "2026-11-13T00:00:00Z",
					message: { role: "assistant", content: "1" },
					done: true,
					done_reason: "stop",
					prompt_eval_count: 1,
					eval_count: 1,
				}),
				{ headers: { "Content-Type": "application/json" } },
			);
		}),
	);
	return bodies;
}

const { getModel } = await import("./service");

type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]["providerOptions"]>;

const send = async (input: Parameters<typeof getModel>[0], providerOptions?: ProviderOptions) => {
	const bodies = stubOllama();
	await generateText({
		model: getModel(input),
		prompt: "Hi",
		maxRetries: 0,
		...(providerOptions ? { providerOptions } : {}),
	});
	return bodies[0] ?? {};
};

const usage = {
	userId: "user",
	operationId: "test",
	action: "improve" as const,
	providerId: "connection",
	label: "Test connection",
};

const ollama = {
	usage,
	provider: "ollama" as const,
	model: "llama3.1",
	apiKey: "k",
	baseURL: "https://ollama.example.test/api",
};

describe("Ollama context window", () => {
	it("sends the connection's context window as num_ctx", async () => {
		const body = await send({ ...ollama, contextTokens: 32_768 });
		expect(body).toMatchObject({ options: { num_ctx: 32_768 } });
	});

	it("keeps the other Ollama options a request carries", async () => {
		const body = await send({ ...ollama, contextTokens: 32_768 }, { ollama: { options: { temperature: 0 } } });
		expect(body).toMatchObject({ options: { num_ctx: 32_768, temperature: 0 } });
	});

	it("sends no num_ctx when the connection has no context window", async () => {
		const body = await send({ ...ollama, contextTokens: null });
		expect((body.options as Record<string, unknown> | undefined)?.num_ctx).toBeUndefined();
	});

	it("leaves other providers alone", async () => {
		const bodies = stubOllama();
		await generateText({
			model: getModel({
				usage,
				provider: "openai-compatible",
				model: "m",
				apiKey: "k",
				baseURL: "https://llm.example.test/v1",
				contextTokens: 32_768,
			}),
			prompt: "Hi",
			maxRetries: 0,
		}).catch(() => undefined);
		expect(JSON.stringify(bodies[0] ?? {})).not.toContain("num_ctx");
	});
});
