import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { Provider } from "@earendil-works/pi-ai/models";
import {
  createAssistantMessageEventStream, type Api, type AssistantMessageEventStream, type Model, type TranscriptContext,
} from "@earendil-works/pi-ai";

const labelError = "openai-accounts.json must contain labels: an array of nonempty account labels (letters, numbers, _ or -)";

function isAccountLabel(label: unknown): label is string {
  return typeof label === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(label);
}

export function parseLabels(config: unknown): string[] {
  if (typeof config !== "object" || config === null || !("labels" in config) || !Array.isArray(config.labels) ||
      !config.labels.every(isAccountLabel)) {
    throw new Error(labelError);
  }
  return [...new Set<string>(config.labels)];
}

export function accountProvider(label: string, upstream = builtinProviders().find((provider) => provider.id === "openai")): Provider {
  if (!upstream) throw new Error("The built-in OpenAI provider is unavailable");
  if (!isAccountLabel(label)) throw new Error(labelError);
  const id = `openai:${label}`;
  const upstreamId = upstream.id;
  const oauth = upstream.auth.oauth;
  if (!oauth) throw new Error("The built-in OpenAI provider does not support OAuth");
  const models = upstream.getModels().map((model) => ({ ...model, provider: id }));

  // The delegate needs the built-in ID for ChatGPT subscription requests. Swap
  // the two IDs in the request so Pi treats only this account's replies as its own.
  function contextForUpstream(context: TranscriptContext): TranscriptContext {
    const messages = context.messages.map((message) => {
      if (message.role !== "assistant") return message;
      if (message.provider === id) return { ...message, provider: upstreamId };
      if (message.provider === upstreamId) return { ...message, provider: id };
      return message;
    });
    return { ...context, messages };
  }

  function relay(
    model: Model<Api>, signal: AbortSignal | undefined, start: () => AssistantMessageEventStream,
  ): AssistantMessageEventStream {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      try {
        for await (const event of start()) {
          if ("partial" in event) stream.push({ ...event, partial: { ...event.partial, provider: id } });
          else if (event.type === "done") stream.push({ ...event, message: { ...event.message, provider: id } });
          else stream.push({ ...event, error: { ...event.error, provider: id } });
        }
      } catch (error) {
        const reason = signal?.aborted ? "aborted" : "error";
        stream.push({
          type: "error", reason,
          error: {
            role: "assistant", provider: id, api: model.api, model: model.id, content: [],
            stopReason: reason,
            errorMessage: error instanceof Error ? error.message : String(error),
            timestamp: Date.now(),
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          },
        });
      } finally {
        stream.end();
      }
    })();
    return stream;
  }

  return {
    id,
    name: `OpenAI (${label})`,
    baseUrl: upstream.baseUrl,
    headers: upstream.headers,
    // Deliberately omit API-key auth: OPENAI_API_KEY must never select the wrong account.
    auth: { oauth: { ...oauth, name: `OpenAI (${label}, ChatGPT subscription)` } },
    getModels: () => models,
    stream: (model, context, options) => relay(model, options?.signal, () => upstream.stream(
      { ...model, provider: upstreamId }, contextForUpstream(context), options)),
    streamSimple: (model, context, options) => relay(model, options?.signal, () => upstream.streamSimple(
      { ...model, provider: upstreamId }, contextForUpstream(context), options)),
  };
}
