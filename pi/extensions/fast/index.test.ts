import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, ExtensionEvent, SessionEntry } from "@earendil-works/pi-coding-agent";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import extension from "./index.ts";
import { normalizeContext } from "@earendil-works/pi-ai";
import { accountProvider } from "../openai-accounts/provider.ts";
import { FAST_STATUS_KEY } from "../contracts/status-keys.ts";

function setup() {
  const events = new Map<string, (event: any, ctx: ExtensionContext) => unknown>();
  let command!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  const entries: SessionEntry[] = [];
  const notices: string[] = [];
  const statuses = new Map<string, string>();
  const pi = {
    on: (name: string, handler: (event: ExtensionEvent, ctx: ExtensionContext) => unknown) => { events.set(name, handler); },
    registerCommand: (_name: string, options: { handler: typeof command }) => { command = options.handler; },
    appendEntry: (customType: string, data: unknown) => {
      entries.push({ type: "custom", customType, data, id: String(entries.length), parentId: null, timestamp: "" });
    },
  };
  extension(pi as unknown as ExtensionAPI);
  const ctx = {
    model: openaiProvider().getModels()[0],
    sessionManager: { getEntries: () => entries },
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      setStatus: (key: string, value: string | undefined) => { if (value) statuses.set(key, value); else statuses.delete(key); },
      notify: (message: string) => { notices.push(message); },
    },
  } as unknown as ExtensionCommandContext;
  return { ctx, entries, notices, statuses,
    command: (args = "") => command(args, ctx),
    fire: (name: string, event: unknown = {}) => events.get(name)?.(event, ctx),
    request: (payload: unknown = { model: ctx.model?.id }) => events.get("before_provider_request")?.({ payload }, ctx),
  };
}

test("fast defaults off; command toggles exact service tier without mutating the payload", async () => {
  const h = setup();
  h.fire("session_start");
  assert.equal(h.request(), undefined);
  assert.equal(h.statuses.has(FAST_STATUS_KEY), false);
  await h.command();
  const payload = { model: h.ctx.model?.id, service_tier: "auto", store: false };
  assert.deepEqual(h.request(payload), { ...payload, service_tier: "priority" });
  assert.equal(payload.service_tier, "auto");
  assert.equal(h.statuses.get(FAST_STATUS_KEY), "⚡ fast");
  assert.match(h.notices[0], /cost or quota/);
  await h.command();
  assert.equal(h.request(payload), undefined);
  assert.equal(h.statuses.has(FAST_STATUS_KEY), false);
  assert.equal(h.entries.length, 2);
});

test("on/off are idempotent; invalid arguments do not change state", async () => {
  const h = setup();
  await h.command("on");
  await h.command("on");
  assert.equal(h.entries.length, 1);
  await h.command("invalid");
  assert.match(h.notices.at(-1) ?? "", /Usage/);
  assert.ok(h.request());
  await h.command("off");
  await h.command("off");
  assert.equal(h.entries.length, 2);
});

test("aliases and Codex are supported, other providers/APIs and unrelated payloads are untouched", async () => {
  const h = setup();
  await h.command("on");
  for (const provider of ["openai", "openai:work", "openai-codex"]) {
    h.ctx.model = { ...h.ctx.model!, provider };
    if (provider === "openai-codex") h.ctx.model = { ...h.ctx.model, api: "openai-codex-responses" };
    h.fire("model_select");
    assert.ok(h.request());
    assert.equal(h.statuses.get(FAST_STATUS_KEY), "⚡ fast");
  }
  for (const payload of [null, [], "payload", { model: "other" }, {}]) assert.equal(h.request(payload), undefined);
  h.ctx.model = { ...h.ctx.model!, provider: "anthropic" };
  h.fire("model_select");
  assert.equal(h.request(), undefined);
  assert.equal(h.statuses.has(FAST_STATUS_KEY), false);
  h.ctx.model = { ...h.ctx.model, provider: "openai", api: "openai-completions" };
  assert.equal(h.request(), undefined);
});

test("unsupported models cannot enable fast, but can disable a previously enabled preference", async () => {
  const h = setup();
  h.ctx.model = undefined;
  await h.command();
  assert.equal(h.entries.length, 0);
  assert.match(h.notices[0], /Select an OpenAI/);
  h.ctx.model = openaiProvider().getModels()[0];
  await h.command("on");
  h.ctx.model = undefined;
  await h.command("off");
  assert.equal(h.entries.length, 2);
});

test("resume/reload restore the last valid session preference; a fresh session resets it", async () => {
  const h = setup();
  await h.command("on");
  h.fire("session_shutdown");
  assert.equal(h.statuses.has(FAST_STATUS_KEY), false);
  h.fire("session_start");
  assert.ok(h.request());
  await h.command("off");
  h.fire("session_start");
  assert.equal(h.request(), undefined);
  await h.command("on");
  h.entries.length = 0;
  h.fire("session_start");
  assert.equal(h.request(), undefined);
});

test("the fast hook rewrites the real account alias subscription request before network I/O", async () => {
  const h = setup();
  const provider = accountProvider("work");
  h.ctx.model = provider.getModels()[0];
  await h.command("on");
  let inspected = false;
  const stream = provider.streamSimple(h.ctx.model, normalizeContext({ messages: [] }), {
    apiKey: "fake-subscription-token",
    onPayload: (payload) => {
      const rewritten = h.request(payload);
      assert.ok(typeof rewritten === "object" && rewritten !== null && "service_tier" in rewritten);
      assert.equal(rewritten.service_tier, "priority");
      inspected = true;
      throw new Error("stop before network");
    },
  });
  const result = await stream.result();
  assert.equal(inspected, true);
  assert.equal(result.provider, "openai:work");
  assert.match(result.errorMessage ?? "", /stop before network/);
});

test("fast mode uses the priority wire tier accepted by the OpenAI endpoint", async () => {
  const h = setup();
  const provider = accountProvider("work");
  h.ctx.model = provider.getModels()[0];
  await h.command("on");
  let requests = 0;
  const stream = provider.streamSimple(h.ctx.model, normalizeContext({ messages: [] }), {
    apiKey: "fake-subscription-token", maxRetries: 0,
    onPayload: (payload) => h.request(payload),
    fetch: async (_url, init) => {
      requests++;
      const payload = JSON.parse(String(init?.body));
      if (payload.service_tier !== "priority") {
        return new Response(JSON.stringify({ detail: `Unsupported service_tier: ${payload.service_tier}` }), {
          status: 400, headers: { "content-type": "application/json" },
        });
      }
      return new Response(`data: ${JSON.stringify({ type: "response.completed", response: {
        id: "resp_test", status: "completed", output: [], service_tier: "priority",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
    },
  });
  const result = await stream.result();
  assert.equal(requests, 1);
  assert.equal(result.stopReason, "stop", result.errorMessage);
});
