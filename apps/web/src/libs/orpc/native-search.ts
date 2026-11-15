import type { client } from "./client";
import { aiDestination, supportsNativeWebSearch } from "@reactive-resume/ai/types";

type NativeSearchApi = Pick<typeof client, "aiProviders" | "agent" | "ai">;

/**
 * Upstream asks before every AI request ("Share data with …?"). The fork doesn't: choosing an AI action is the
 * approval. The one thing that prompt still carried is native web search, which the server only uses when the request
 * names the connection allowed to search with its own search service. That is added here, without a prompt, for the
 * two places that offer it on purpose: Retry with <connection> when adding an application, and Coach or Assistant
 * messages with web research on. Every other request goes out unchanged.
 */
export async function nativeSearchContext(
	path: readonly string[],
	input: unknown,
	api: NativeSearchApi,
	signal?: AbortSignal,
): Promise<{ aiDestination: string; nativeSearchFallback: true } | undefined> {
	const operation = path.join(".");
	const fields = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
	const context =
		fields.context && typeof fields.context === "object" ? (fields.context as Record<string, unknown>) : {};
	const retry = operation === "applications.ai.searchPostings" && typeof fields.aiProviderId === "string";
	const chat = operation === "agent.messages.send" && typeof fields.threadId === "string" && context.web !== false;
	if (!retry && !chat) return;

	const options = signal ? { signal } : {};
	const providers = await api.aiProviders.list({}, options);
	const id = retry
		? fields.aiProviderId
		: (await api.agent.threads.get({ id: fields.threadId as string }, options)).thread.aiProviderId;
	const provider =
		providers.find((entry) => entry.managed) ??
		providers.find((entry) => entry.id === id && entry.enabled && entry.testStatus === "success");
	if (!provider?.recipientVersion || !supportsNativeWebSearch(provider)) return;
	const capabilities = await api.ai.capabilities({}, options).catch(() => null);
	if (capabilities?.nativeWebSearch !== 1) return;
	return { aiDestination: aiDestination(provider), nativeSearchFallback: true };
}
