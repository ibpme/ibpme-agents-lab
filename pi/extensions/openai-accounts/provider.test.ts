import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels, createAssistantMessageEventStream, normalizeContext, InMemoryCredentialStore, type AssistantMessage, type OAuthCredential, type ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { accountProvider, parseLabels } from "./provider.ts";

const credential = (access: string, expires = Date.now() + 3600000): OAuthCredential => ({
  type: "oauth", access, refresh: `${access}-refresh`, expires,
});

test("labels default elsewhere, validate strictly, deduplicate, and allow disabling aliases", () => {
  assert.deepEqual(parseLabels({ labels: ["work", "personal-2", "work"] }), ["work", "personal-2"]);
  assert.deepEqual(parseLabels({ labels: [] }), []);
  for (const labels of [undefined, "work", [""], ["work/other"], ["work:other"], [3], [" work"]]) {
    assert.throws(() => parseLabels({ labels }), /labels/);
  }
});

test("alias inherits the host chat catalog and OAuth but never API-key fallback or classifiers", () => {
  const upstream = openaiProvider();
  const alias = accountProvider("work", upstream);
  assert.equal(alias.id, "openai:work");
  assert.equal(alias.auth.apiKey, undefined);
  assert.equal(alias.auth.oauth?.login, upstream.auth.oauth?.login);
  assert.equal(alias.auth.oauth?.refresh, upstream.auth.oauth?.refresh);
  assert.deepEqual(alias.getModels(), upstream.getModels().map((model) => ({ ...model, provider: alias.id })));
  assert.ok(upstream.getModels().every((model) => model.provider === "openai"));
  assert.equal(alias.getAllModels, undefined);
});

test("native login, locked refresh, logout, and cancellation stay scoped to the alias", async () => {
  const credentials = new InMemoryCredentialStore();
  const original = credential("original");
  await credentials.modify("openai", async () => original);
  let refreshes = 0;
  const upstream = openaiProvider();
  const alias = accountProvider("work", {
    ...upstream,
    auth: { oauth: {
      name: "Fake OAuth",
      login: async (interaction) => {
        interaction.signal.throwIfAborted();
        return credential("work", 0);
      },
      refresh: async (current, signal) => {
        signal.throwIfAborted();
        refreshes++;
        assert.equal(current.refresh, "work-refresh");
        return credential("rotated");
      },
      toAuth: async (current) => ({ apiKey: current.access }),
    } },
  });
  const models = createModels({ credentials, authContext: {
    env: async () => "must-not-use-environment-key", fileExists: async () => false,
  } });
  models.setProvider(alias);
  assert.equal(await models.getAuth(alias.id), undefined);
  const interaction: ProviderAuthInteraction = {
    signal: new AbortController().signal, prompt: async () => "", notify: () => {},
  };
  await models.login(alias.id, "oauth", interaction);
  const results = await Promise.all([models.getAuth(alias.id), models.getAuth(alias.id)]);
  assert.ok(results.every((result) => result?.auth.apiKey === "rotated"));
  assert.equal(refreshes, 1);
  assert.equal((await credentials.read("openai:work"))?.type, "oauth");
  assert.equal((await credentials.read("openai"))?.type, "oauth");
  await models.logout(alias.id);
  assert.equal(await credentials.read(alias.id), undefined);
  assert.deepEqual(await credentials.read("openai"), original);
  await assert.rejects(models.login(alias.id, "oauth", { ...interaction, signal: AbortSignal.abort() }));
  assert.equal(await credentials.read(alias.id), undefined);
});

test("both stream entry points preserve OpenAI subscription payload rules and alias error identity", async () => {
  const alias = accountProvider("work");
  const model = alias.getModels()[0];
  assert.ok(model);
  for (const method of ["stream", "streamSimple"] as const) {
    let inspected = false;
    const stream = alias[method](model, normalizeContext({ messages: [] }), {
      apiKey: "subscription-access-token", maxTokens: 100, temperature: 0.5,
      onPayload: (payload, requestModel) => {
        inspected = true;
        assert.equal(requestModel.provider, "openai");
        assert.ok(typeof payload === "object" && payload !== null);
        assert.equal("max_output_tokens" in payload, false);
        assert.equal("temperature" in payload, false);
        throw new Error("intentional stop before network");
      },
    });
    const events = [];
    for await (const event of stream) {
      events.push(event.type);
      if ("partial" in event) assert.equal(event.partial.provider, alias.id);
    }
    const result = await stream.result();
    assert.equal(inspected, true);
    assert.equal(result.provider, alias.id);
    assert.equal(result.model, model.id);
    assert.equal(result.stopReason, "error");
    assert.match(result.errorMessage ?? "", /intentional stop/);
    assert.equal(events.filter((type) => type === "error").length, 1);
  }
});

test("successful streams retain tools, usage, hooks, cancellation signal, and account history without mutation", async () => {
  const upstream = openaiProvider();
  const model = upstream.getModels()[0];
  const message: AssistantMessage = {
    role: "assistant", provider: "openai", model: model.id, api: model.api, timestamp: 1,
    content: [{ type: "toolCall", id: "call_1|fc_1", name: "lookup", arguments: { query: "hello" } }],
    stopReason: "toolUse",
    usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 0, totalTokens: 17,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const history = { ...message, provider: "openai:work" };
  const signal = new AbortController().signal;
  const onResponse = () => {};
  let calls = 0;
  const alias = accountProvider("work", {
    ...upstream,
    streamSimple(requestModel, context, options) {
      calls++;
      assert.equal(requestModel.provider, "openai");
      assert.equal(context.messages[0].role === "assistant" && context.messages[0].provider, "openai");
      assert.equal(options?.signal, signal);
      assert.equal(options?.onResponse, onResponse);
      assert.equal(options?.apiKey, "work-token");
      const result = createAssistantMessageEventStream();
      result.push({ type: "start", partial: message });
      result.push({ type: "done", reason: "toolUse", message });
      result.end();
      return result;
    },
  });
  const result = alias.streamSimple(alias.getModels()[0], normalizeContext({ messages: [history] }), {
    apiKey: "work-token", signal, onResponse,
  });
  const events = [];
  for await (const event of result) events.push(event);
  assert.deepEqual(events.map((event) => event.type), ["start", "done"]);
  assert.deepEqual(await result.result(), { ...message, provider: alias.id });
  assert.equal(message.provider, "openai");
  assert.equal(history.provider, alias.id);
  assert.equal(calls, 1);
});
