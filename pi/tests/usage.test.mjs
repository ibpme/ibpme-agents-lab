import assert from "node:assert/strict";
import test from "node:test";
import pager from "../extensions/pager/index.ts";
import usage from "../extensions/usage/index.ts";
import { formatUsage } from "../extensions/usage/formatting.ts";
import { collectUsage, selectProviders } from "../extensions/usage/service.ts";

const goUrl = "https://opencode.ai/inference/go/v1/usage";
const codexUrl = "https://chatgpt.com/backend-api/wham/usage";
const goResponse = {
  usage: {
    rolling: { status: "ok", percent: 25, resetsAt: "2031-01-01T00:00:00Z" },
    weekly: { status: "rate-limited", percent: 100 },
  },
};
const codexResponse = {
  plan_type: "plus\x1b[31m\u202e", rate_limit: { primary_window: { used_percent: 70, limit_window_seconds: 18000 } },
};
const login = { type: "oauth", access: "fake-codex-token", refresh: "fake-refresh", expires: 100, accountId: "fake-account" };

function setup() {
  const configured = ["opencode-go", "openai", "openai-codex", "openai:Work"];
  const models = [
    { provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/openai/v1" },
    { provider: "openai-codex", baseUrl: "https://chatgpt.com/backend-api" },
  ];
  const auth = {
    "opencode-go": { source: "OPENCODE_API_KEY", auth: { apiKey: "fake-go-key" } },
    "openai-codex": { source: "OAuth", auth: { apiKey: login.access } },
  };
  const ctx = {
    modelRegistry: {
      getRegisteredProviderIds: () => ["openai:Work", "openai:unused", "other"],
      getProviderAuthStatus: (provider) => ({ configured: configured.includes(provider), source: "stored" }),
      getProviderAuth: async (provider) => { assert.ok(auth[provider]); return auth[provider]; },
      getApiKeyAndHeaders: async (model) => ({ ok: true, ...auth[model.provider].auth }),
      getAll: () => models,
    },
  };
  const requests = [];
  const deps = {
    readCredential(provider) {
      if (provider === "openai") return { ...login, access: "fake-native-token" };
      if (provider === "openai-codex") return login;
    },
    fetch: async (url, options) => {
      assert.ok(url === goUrl || url === codexUrl);
      requests.push({ url, options });
      return Response.json(url === goUrl ? goResponse : codexResponse);
    },
  };
  const controller = new AbortController();
  return { ctx, deps, auth, models, requests, controller, query: (...providers) => collectUsage(providers, ctx, deps, controller.signal) };
}

test("usage lists configured accounts separately and sends each quota request its own credential", async () => {
  const h = setup();
  const providers = selectProviders("", h.ctx);
  assert.deepEqual(providers, ["opencode-go", "openai", "openai-codex", "openai:Work"]);
  assert.deepEqual(selectProviders("openai:Work", h.ctx), ["openai:Work"]);
  assert.throws(() => selectProviders("unsupported", h.ctx), /Use \/usage/);
  const reports = await h.query(...providers);
  assert.deepEqual(reports.map(({ provider }) => provider), providers);
  assert.equal(h.requests.length, 2);
  const go = h.requests.find(({ url }) => url === goUrl);
  const codex = h.requests.find(({ url }) => url === codexUrl);
  assert.equal(go.options.headers.Authorization, "Bearer fake-go-key");
  assert.equal(go.options.headers["ChatGPT-Account-Id"], undefined);
  assert.equal(codex.options.headers.Authorization, "Bearer fake-codex-token");
  assert.equal(codex.options.headers["ChatGPT-Account-Id"], "fake-account");
  assert.ok(h.requests.every(({ options }) => options.method === "GET" && options.redirect === "error"));
  const text = formatUsage(reports);
  assert.match(text, /25% used · 75% left/);
  assert.match(text, /rate limited/);
  assert.match(text, /Usage unavailable/);
  assert.match(text, /OpenAI \(Work\) · ChatGPT/);
  assert.equal(text.match(/chatgpt\.com\/settings\/usage/g).length, 2);
  assert.doesNotMatch(text, /fake-|\x1b|\u202e/);
});

test("native OpenAI API-key usage links to the platform without probing quota endpoints", async () => {
  const h = setup();
  h.deps.readCredential = () => ({ type: "api_key", key: "fake-api-key" });
  const [report] = await h.query("openai");
  assert.match(formatUsage([report]), /platform\.openai\.com\/usage/);
  assert.deepEqual(h.requests, []);
});

test("usage rejects proxy and mismatched credentials before sending a request", async () => {
  const h = setup();
  h.models[0].baseUrl = "https://proxy.example/v1";
  h.ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: true, apiKey: "fake-other-token" });
  const reports = await h.query("opencode-go", "openai-codex");
  assert.match(reports[0].notes[0], /official provider origin/);
  assert.match(reports[1].notes[0], /authorization differs/);
  assert.deepEqual(h.requests, []);

  h.ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: true, ...h.auth["openai-codex"].auth });
  h.deps.readCredential = () => ({ ...login, access: "fake-mismatched-stored-token" });
  const [report] = await h.query("openai-codex");
  assert.match(report.notes[0], /does not match Pi's stored/);
  assert.deepEqual(h.requests, []);
});

test("a provider fault redacts its response body and preserves other reports", async () => {
  const h = setup();
  const original = h.deps.fetch;
  h.deps.fetch = (url, options) => url === goUrl
    ? Promise.resolve(new Response("fake-provider-secret", { status: 401 }))
    : original(url, options);
  const reports = await h.query("opencode-go", "openai-codex");
  assert.match(reports[0].notes[0], /HTTP 401/);
  assert.doesNotMatch(formatUsage(reports), /fake-provider-secret/);
  assert.equal(reports[1].windows[0].usedPercent, 70);
});

function commandHost(withPager = false) {
  const h = setup();
  const lifecycle = new Map();
  const subscriptions = new Map();
  const notifications = [];
  let command;
  let viewer;
  let renders = 0;
  const events = {
    on: (name, handler) => subscriptions.set(name, handler),
    emit: (name, offer) => subscriptions.get(name)?.(offer),
  };
  if (withPager) pager({ events });
  usage({ events, on: (name, handler) => lifecycle.set(name, handler), registerCommand: (_name, entry) => { command = entry; } });
  const ctx = {
    ...h.ctx, mode: "tui",
    ui: {
      notify: (message) => notifications.push(message),
      custom: (factory) => new Promise((resolve) => {
        const theme = { fg: (_color, text) => text, bold: (text) => text };
        viewer = factory({ terminal: { rows: 24 }, requestRender: () => { renders++; } }, theme, undefined, resolve);
      }),
    },
  };
  return {
    ctx, notifications,
    run: (args) => command.handler(args, ctx),
    fire: (event) => lifecycle.get(event)(),
    render: () => viewer.render(90),
    close: () => viewer.handleInput("\x1b"),
    get renders() { return renders; },
  };
}

for (const withPager of [false, true]) {
  test(`usage shows loading and updates in the ${withPager ? "framed pager" : "local viewer"}`, async (t) => {
    const pending = Promise.withResolvers();
    const requested = Promise.withResolvers();
    t.mock.method(globalThis, "fetch", () => { requested.resolve(); return pending.promise; });
    const h = commandHost(withPager);
    const running = h.run("opencode-go");
    assert.equal(h.render()[0].startsWith("┌"), withPager);
    assert.match(h.render().join("\n"), /Loading account usage/);
    await requested.promise;
    pending.resolve(Response.json(goResponse));
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(h.render().join("\n"), /25% used/);
    assert.equal(h.renders, 1);
    h.close();
    await running;
  });
}

test("closing usage aborts the HTTP lookup and releases the busy guard", async (t) => {
  const started = Promise.withResolvers();
  t.mock.method(globalThis, "fetch", (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    started.resolve(signal);
  }));
  const h = commandHost(true);
  const running = h.run("opencode-go");
  const signal = await started.promise;
  await h.run("opencode-go");
  assert.match(h.notifications[0], /already running/);
  h.close();
  await running;
  assert.equal(signal.aborted, true);
  assert.equal(h.renders, 0);

  h.ctx.mode = "rpc";
  await h.run("openai:Work");
  assert.match(h.notifications.at(-1), /chatgpt\.com\/settings\/usage/);
});

test("session shutdown suppresses late RPC reports and permits lookups in the next session", async (t) => {
  const started = Promise.withResolvers();
  t.mock.method(globalThis, "fetch", (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    started.resolve(signal);
  }));
  const h = commandHost();
  h.ctx.mode = "rpc";
  const running = h.run("opencode-go");
  const signal = await started.promise;
  h.fire("session_shutdown");
  await running;
  assert.equal(signal.aborted, true);
  assert.deepEqual(h.notifications, []);
  h.fire("session_start");
  await h.run("openai:Work");
  assert.match(h.notifications[0], /OpenAI \(Work\)/);
});

test("session replacement releases a disposed TUI viewer even if it never calls done", async () => {
  const h = commandHost(true);
  const auth = Promise.withResolvers();
  h.ctx.modelRegistry.getProviderAuth = () => auth.promise;
  const running = h.run("opencode-go");
  assert.match(h.render().join("\n"), /Loading account usage/);
  h.fire("session_shutdown");
  await running;
  assert.equal(h.renders, 0);

  h.fire("session_start");
  h.ctx.mode = "rpc";
  await h.run("openai:Work");
  assert.match(h.notifications[0], /OpenAI \(Work\)/);
  auth.resolve(undefined);
});
