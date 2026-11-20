import assert from "node:assert/strict";
import test from "node:test";
import { createModels, InMemoryCredentialStore, normalizeContext } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import fast from "../extensions/fast/index.ts";
import { accountProvider, parseLabels } from "../extensions/openai-accounts/provider.ts";
import { switchAccount } from "../extensions/openai-accounts/switch.ts";

const model = openaiProvider().getModels()[0];
const credential = (access, expires = Date.now() + 3_600_000) => ({ type: "oauth", access, refresh: "fake-refresh", expires });

test("labeled accounts have a separate OAuth login and reuse the host chat catalog", async () => {
  assert.deepEqual(parseLabels({ labels: ["work", "personal", "work"] }), ["work", "personal"]);
  assert.deepEqual(parseLabels({ labels: [] }), []);
  assert.throws(() => parseLabels({ labels: ["with space"] }), /labels/);

  const credentials = new InMemoryCredentialStore();
  const original = credential("original");
  await credentials.modify("openai", async () => original);
  const upstream = openaiProvider();
  let refreshes = 0;
  const alias = accountProvider("work", {
    ...upstream,
    auth: { oauth: {
      name: "Fake OAuth",
      login: async ({ signal }) => { signal.throwIfAborted(); return credential("work", 0); },
      refresh: async () => { refreshes++; return credential("rotated"); },
      toAuth: async ({ access }) => ({ apiKey: access }),
    } },
  });
  assert.equal(alias.auth.apiKey, undefined);
  assert.equal(alias.getAllModels, undefined);
  assert.deepEqual(alias.getModels(), upstream.getModels().map((model) => ({ ...model, provider: "openai:work" })));

  const models = createModels({ credentials, authContext: { env: async () => "unrelated-key", fileExists: async () => false } });
  models.setProvider(alias);
  assert.equal(await models.getAuth(alias.id), undefined);
  const interaction = { signal: new AbortController().signal, prompt: async () => "", notify() {} };
  await models.login(alias.id, "oauth", interaction);
  assert.equal((await models.getAuth(alias.id)).auth.apiKey, "rotated");
  assert.equal(refreshes, 1);
  await models.logout(alias.id);
  assert.equal(await credentials.read(alias.id), undefined);
  assert.deepEqual(await credentials.read("openai"), original);
  await assert.rejects(models.login(alias.id, "oauth", { ...interaction, signal: AbortSignal.abort() }));
});

test("account switching keeps the model and only offers logged-in OpenAI accounts", async () => {
  const available = ["openai", "openai:work", "anthropic"].map((provider) => ({ ...model, provider }));
  const switched = [];
  const notices = [];
  const choices = [];
  const ctx = {
    hasUI: true,
    model,
    modelRegistry: { getAvailable: () => available },
    ui: {
      notify: (message) => notices.push(message),
      select: async (_title, options) => { choices.push(options); return "openai:personal"; },
    },
  };
  const pi = { setModel: async (target) => { switched.push(target); return true; } };
  const ids = ["openai", "openai:work", "openai:personal"];
  await switchAccount(pi, ctx, ids);
  assert.equal(switched[0], available[1]);
  assert.deepEqual(choices, []);

  available.push({ ...model, provider: "openai:personal" });
  await switchAccount(pi, ctx, ids);
  assert.deepEqual(choices, [ids]);
  assert.equal(switched[1], available[3]);
  assert.ok(notices.every((notice) => notice.includes(model.id)));

  available[3] = { ...available[3], id: "different-model" };
  await switchAccount(pi, ctx, ids);
  assert.equal(switched.length, 2);
  assert.match(notices.at(-1), /not available/);
});

test("alias requests replay reasoning only from the selected account", async () => {
  const alias = accountProvider("work");
  const model = alias.getModels()[0];
  const accounts = ["openai", "openai:personal", alias.id];
  const messages = accounts.map((provider, index) => ({
    role: "assistant", provider, api: model.api, model: model.id, timestamp: index,
    stopReason: "stop",
    content: [
      { type: "thinking", thinking: "", thinkingSignature: JSON.stringify({ type: "reasoning", id: `rs_${index}`, summary: [] }) },
      { type: "text", text: `Reply ${index}` },
    ],
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  }));
  const context = normalizeContext({ messages });

  for (const method of ["stream", "streamSimple"]) {
    let input;
    const result = await alias[method](model, context, {
      apiKey: "fake-subscription-token",
      onPayload(payload) {
        input = payload.input;
        throw new Error("Stop before network");
      },
    }).result();
    assert.equal(result.provider, alias.id);
    assert.match(result.errorMessage, /Stop before network/);
    assert.deepEqual(input.filter(({ type }) => type === "reasoning").map(({ id }) => id), ["rs_2"]);
    assert.deepEqual(input.filter(({ type }) => type === "message").map(({ content }) => content[0].text), [
      "Reply 0", "Reply 1", "Reply 2",
    ]);
    assert.deepEqual(context.messages.map(({ provider }) => provider), accounts);
  }
});

function setupFast(activeModel = model) {
  const events = new Map();
  const entries = [];
  const statuses = new Map();
  let command;
  fast({
    registerCommand: (_name, options) => { command = options.handler; },
    on: (name, handler) => events.set(name, handler),
    appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
  });
  const ctx = {
    mode: "tui", model: activeModel,
    sessionManager: { getEntries: () => entries },
    ui: {
      theme: { fg: (_color, text) => text },
      setStatus: (key, value) => statuses.set(key, value),
      notify() {},
    },
  };
  return {
    ctx, entries, statuses,
    run: (args) => command(args, ctx),
    fire: (name, event = {}) => events.get(name)(event, ctx),
  };
}

test("fast persists the requested tier and hides the badge on other providers", async () => {
  const h = setupFast();
  const payload = { model: model.id, service_tier: "auto" };
  const request = (body = payload) => h.fire("before_provider_request", { payload: body });
  h.fire("session_start");
  assert.equal(request(), undefined);
  await h.run("on");
  await h.run("on");
  assert.equal(h.entries.length, 1);
  assert.deepEqual(request(), { ...payload, service_tier: "priority" });
  assert.equal(payload.service_tier, "auto");
  assert.equal(request({ model: "different" }), undefined);
  assert.equal(h.statuses.get("openai-fast"), "fast");
  h.fire("session_shutdown");
  assert.equal(h.statuses.get("openai-fast"), undefined);
  h.fire("session_start");
  assert.equal(h.statuses.get("openai-fast"), "fast");
  h.ctx.model = { ...model, provider: "anthropic" };
  h.fire("model_select");
  assert.equal(h.statuses.get("openai-fast"), undefined);
  assert.equal(request(), undefined);
  await h.run("off");
  h.ctx.model = model;
  h.fire("session_start");
  assert.equal(request(), undefined);
});

test("fast publishes plain RPC status and clears it on shutdown", async () => {
  const h = setupFast();
  h.ctx.mode = "rpc";
  delete h.ctx.ui.theme;
  h.fire("session_start");
  await h.run("on");
  assert.equal(h.statuses.get("openai-fast"), "fast");
  h.fire("session_shutdown");
  assert.equal(h.statuses.get("openai-fast"), undefined);
});

test("the native Responses stream sends priority for an alias and records the alias identity", async () => {
  const alias = accountProvider("work");
  const model = alias.getModels()[0];
  const h = setupFast(model);
  await h.run("on");
  let request;
  const stream = alias.streamSimple(model, normalizeContext({ messages: [] }), {
    apiKey: "fake-subscription-token", maxRetries: 0, maxTokens: 100,
    onPayload: (payload) => h.fire("before_provider_request", { payload }),
    fetch: async (_url, init) => {
      request = JSON.parse(String(init.body));
      const complete = { type: "response.completed", response: {
        id: "resp_test", status: "completed", output: [], service_tier: "priority",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      } };
      return new Response(`data: ${JSON.stringify(complete)}\n\n`, { headers: { "content-type": "text/event-stream" } });
    },
  });
  const result = await stream.result();
  assert.equal(result.stopReason, "stop", result.errorMessage);
  assert.equal(result.provider, "openai:work");
  assert.equal(request.service_tier, "priority");
  assert.equal("max_output_tokens" in request, false);
});
