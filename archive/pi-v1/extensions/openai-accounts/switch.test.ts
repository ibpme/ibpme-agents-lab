import assert from "node:assert/strict";
import { test } from "node:test";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import type { Model, Api } from "@earendil-works/pi-ai";
import { switchAccount } from "./switch.ts";

const base = openaiProvider().getModels()[0];
const accountModel = (provider: string): Model<Api> => ({ ...base, provider });

function setup(providers = ["openai", "openai:work"], current = "openai") {
  const models = providers.map(accountModel);
  const switched: Model<Api>[] = [];
  const notices: string[] = [];
  const menus: string[][] = [];
  let selection: string | undefined;
  let success = true;
  const ctx = {
    model: accountModel(current), hasUI: true,
    modelRegistry: { getAvailable: () => models },
    ui: {
      notify: (message: string) => { notices.push(message); },
      select: async (_title: string, options: string[]) => { menus.push(options); return selection; },
    },
  };
  const pi = { setModel: async (model: Model<Api>) => { switched.push(model); return success; } };
  return { ctx, switched, notices, menus, models,
    select: (value: string | undefined) => { selection = value; },
    fail: () => { success = false; },
    run: () => switchAccount(pi, ctx, ["openai", "openai:work", "openai:personal"]),
  };
}

test("two available accounts toggle in either direction without a menu and retain the model", async () => {
  for (const [current, target] of [["openai", "openai:work"], ["openai:work", "openai"]]) {
    const state = setup(undefined, current);
    await state.run();
    assert.equal(state.switched[0].provider, target);
    assert.equal(state.switched[0].id, base.id);
    assert.equal(state.menus.length, 0);
    assert.match(state.notices[0], /Account:/);
  }
});

test("more than two accounts opens a deduplicated menu, excluding unrelated providers", async () => {
  const state = setup(["openai", "openai:work", "openai:personal", "anthropic"]);
  state.models.push({ ...accountModel("openai:work"), id: "another-model" });
  state.select("openai:personal");
  await state.run();
  assert.deepEqual(state.menus, [["openai", "openai:work", "openai:personal"]]);
  assert.equal(state.switched[0].provider, "openai:personal");
});

test("menu cancellation or choosing the current account is a no-op", async () => {
  for (const selection of [undefined, "openai"]) {
    const state = setup(["openai", "openai:work", "openai:personal"]);
    state.select(selection);
    await state.run();
    assert.deepEqual(state.switched, []);
    assert.deepEqual(state.notices, []);
  }
});

test("unconfigured accounts are not counted and missing logins get guidance", async () => {
  const state = setup(["openai", "anthropic"]);
  await state.run();
  assert.equal(state.switched.length, 0);
  assert.match(state.notices[0], /at least two/);
});

test("switching from an unrelated provider asks rather than choosing an arbitrary account", async () => {
  const state = setup(undefined, "anthropic");
  await state.run();
  assert.equal(state.menus.length, 1);
  assert.equal(state.switched.length, 0);
});

test("missing matching model and failed auth leave a warning instead of reporting success", async () => {
  const missing = setup();
  missing.models[1] = { ...missing.models[1], id: "different-model" };
  await missing.run();
  assert.equal(missing.switched.length, 0);
  assert.match(missing.notices[0], /not available/);
  const failed = setup();
  failed.fail();
  await failed.run();
  assert.match(failed.notices[0], /Could not switch/);
});

test("headless selection fails closed but a two-account toggle still works", async () => {
  const picker = setup(["openai", "openai:work", "openai:personal"]);
  picker.ctx.hasUI = false;
  await picker.run();
  assert.equal(picker.switched.length, 0);
  assert.equal(picker.menus.length, 0);
  const toggle = setup();
  toggle.ctx.hasUI = false;
  await toggle.run();
  assert.equal(toggle.switched[0].provider, "openai:work");
});
