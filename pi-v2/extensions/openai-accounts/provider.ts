import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { Provider } from "@earendil-works/pi-ai/models";
import { createAssistantMessageEventStream, type AssistantMessageEventStream, type TranscriptContext } from "@earendil-works/pi-ai";

export function parseLabels(config: unknown): string[] {
  if (typeof config !== "object" || config === null || !("labels" in config) || !Array.isArray(config.labels) ||
      !config.labels.every((label: unknown) => typeof label === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(label))) {
    throw new Error("openai-accounts.json must contain labels: an array of nonempty account labels (letters, numbers, _ or -)");
  }
  return [...new Set<string>(config.labels)];
}

export function accountProvider(label: string, upstream = builtinProviders().find((provider) => provider.id === "openai")): Provider {
  if (!upstream) throw new Error("The built-in OpenAI provider is unavailable");
  parseLabels({ labels: [label] });
  const id = `openai:${label}`;
  const oauth = upstream.auth.oauth;
  if (!oauth) throw new Error("The built-in OpenAI provider does not support OAuth");
  const models = upstream.getModels().map((model) => ({ ...model, provider: id }));

  // OpenAI's implementation gates subscription behavior on model.provider === "openai".
  // Normalize our own history too, so tool-call IDs survive account switches and resume.
  const contextForUpstream = (context: TranscriptContext): TranscriptContext => ({
    ...context,
    messages: context.messages.map((message) => message.role === "assistant" && message.provider === id
      ? { ...message, provider: upstream.id }
      : message),
  });
  const forward = (modelId: string, signal: AbortSignal | undefined, start: () => AssistantMessageEventStream): AssistantMessageEventStream => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      try {
        for await (const event of start()) {
          if ("partial" in event) stream.push({ ...event, partial: { ...event.partial, provider: id } });
          else if (event.type === "done") stream.push({ ...event, message: { ...event.message, provider: id } });
          else if (event.type === "error") stream.push({ ...event, error: { ...event.error, provider: id } });
          else stream.push(event);
        }
      } catch (error) {
        stream.push({
          type: "error", reason: signal?.aborted ? "aborted" : "error",
          error: {
            role: "assistant", provider: id, api: "openai-responses", model: modelId, content: [],
            stopReason: signal?.aborted ? "aborted" : "error", errorMessage: error instanceof Error ? error.message : String(error), timestamp: Date.now(),
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          },
        });
      } finally {
        stream.end();
      }
    })();
    return stream;
  };

  return {
    id,
    name: `OpenAI (${label})`,
    baseUrl: upstream.baseUrl,
    headers: upstream.headers,
    // Deliberately omit API-key auth: OPENAI_API_KEY must never select the wrong account.
    auth: { oauth: { ...oauth, name: `OpenAI (${label}, ChatGPT subscription)` } },
    getModels: () => models,
    stream: (model, context, options) => forward(model.id, options?.signal, () => upstream.stream(
      { ...model, provider: upstream.id }, contextForUpstream(context), options)),
    streamSimple: (model, context, options) => forward(model.id, options?.signal, () => upstream.streamSimple(
      { ...model, provider: upstream.id }, contextForUpstream(context), options)),
  };
}
