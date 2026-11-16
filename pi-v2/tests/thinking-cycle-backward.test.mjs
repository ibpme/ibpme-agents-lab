import assert from "node:assert/strict";
import test from "node:test";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import thinkingCycleBackward from "../extensions/thinking-cycle-backward/index.ts";
import { registerExtension } from "./extension-fixture.mjs";

function setup() {
	let level = "off";
	const changes = [];
	const notices = [];
	const host = registerExtension(thinkingCycleBackward, {
		getThinkingLevel: () => level,
		setThinkingLevel: (next) => { level = next; changes.push(next); },
	});
	assert.deepEqual([...host.shortcuts.keys()], ["shift+left"]);
	const ctx = {
		model: { reasoning: true, thinkingLevelMap: { minimal: null, xhigh: "xhigh" } },
		hasUI: true,
		ui: { notify: (text) => notices.push(text) },
	};
	return {
		ctx, changes, notices,
		cycle: () => host.shortcuts.get("shift+left").handler(ctx),
		get level() { return level; },
		set level(next) { level = next; },
	};
}

test("cycles model-supported levels backward and wraps from the first to the last", async () => {
	const h = setup();
	const levels = getSupportedThinkingLevels(h.ctx.model);
	h.level = levels[0];
	for (const expected of [...levels].reverse()) {
		await h.cycle();
		assert.equal(h.level, expected);
		assert.equal(h.notices.at(-1), `Thinking level: ${expected}`);
	}
	assert.equal(h.changes.length, levels.length);
	assert.ok(!h.changes.includes("minimal"), "unsupported levels are skipped");
});

test("reads the current model and thinking level on every invocation", async () => {
	const h = setup();
	h.ctx.model = { reasoning: true, thinkingLevelMap: { xhigh: null, max: null } };
	const levels = getSupportedThinkingLevels(h.ctx.model);
	h.level = levels.at(-1);
	await h.cycle();
	assert.equal(h.level, levels.at(-2));
	h.level = "max";
	await h.cycle();
	assert.equal(h.level, levels.at(-1), "a level outside the new model's list wraps to its highest supported level");
});

test("missing and non-reasoning models leave the thinking level unchanged", async () => {
	const h = setup();
	h.level = "high";
	for (const model of [undefined, { reasoning: false }]) {
		h.ctx.model = model;
		await h.cycle();
		assert.equal(h.level, "high");
		assert.equal(h.notices.at(-1), "Current model does not support thinking");
	}
	assert.deepEqual(h.changes, []);
});

test("reports Pi's effective level after the host clamps a requested level", async () => {
	const notices = [];
	const requests = [];
	const host = registerExtension(thinkingCycleBackward, {
		getThinkingLevel: () => "low",
		setThinkingLevel: (next) => requests.push(next),
	});
	const model = { reasoning: true };
	await host.shortcuts.get("shift+left").handler({
		model, hasUI: true, ui: { notify: (text) => notices.push(text) },
	});
	const levels = getSupportedThinkingLevels(model);
	assert.deepEqual(requests, [levels[levels.indexOf("low") - 1]]);
	assert.equal(notices.at(-1), "Thinking level: low");
});

test("does not notify when UI is unavailable", async () => {
	const h = setup();
	h.ctx.hasUI = false;
	h.ctx.ui = new Proxy({}, { get: () => assert.fail("UI must not be accessed") });
	await h.cycle();
	h.ctx.model = undefined;
	await h.cycle();
});
