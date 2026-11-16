import assert from "node:assert/strict";
import test from "node:test";
import contextUsage from "../extensions/context-usage/index.ts";
import { registerExtension } from "./extension-fixture.mjs";

function setup(mode = "tui") {
	const widgets = new Map([["other-extension", "unchanged"]]);
	const paints = [];
	const calls = [];
	const ctx = {
		mode,
		model: { contextWindow: 200000 },
		getContextUsage: () => ({ percent: 45, tokens: 90000, contextWindow: 200000 }),
		ui: new Proxy({
			theme: { fg: (color, text) => { paints.push({ color, text }); return text; } },
			setWidget(key, value, options) {
				calls.push({ key, value, options });
				if (value === undefined) widgets.delete(key);
				else widgets.set(key, value);
			},
		}, {
			get(target, key) {
				assert.equal(mode, "tui", "non-TUI modes must not access terminal UI");
				assert.ok(Object.hasOwn(target, key), `unexpected UI access: ${String(key)}`);
				return target[key];
			},
		}),
	};
	const host = registerExtension(contextUsage);
	return { ctx, widgets, paints, calls, fire: (event) => host.fire(event, {}, ctx) };
}

test("independent context producer publishes the old ten-cell bar and percentage as an above-editor widget", async () => {
	const h = setup();
	await h.fire("session_start");
	assert.equal(h.widgets.get("context-usage")?.[0], "━━━━━───── 45% 90k/200k");
	assert.ok(h.paints.some(({ color, text }) => color === "warning" && text === "45%"));
	assert.deepEqual(h.calls.map(({ key }) => key), ["context-usage"]);
	assert.deepEqual(h.calls[0].options, { placement: "aboveEditor" });
});

test("context colors preserve the old 40% and 70% thresholds", async () => {
	const h = setup();
	for (const [percent, color] of [[0, "success"], [40, "success"], [40.1, "warning"], [70, "warning"], [70.1, "error"]]) {
		h.ctx.getContextUsage = () => ({ percent, tokens: 100, contextWindow: 1000 });
		await h.fire("message_end");
		assert.equal(h.paints.at(-2).color, color);
	}
});

test("unknown utilization is not presented as zero and model capacity remains available", async () => {
	const h = setup();
	h.ctx.getContextUsage = () => undefined;
	await h.fire("session_start");
	assert.equal(h.widgets.get("context-usage")?.[0], "────────── ? ?/200k");
	h.ctx.model = undefined;
	await h.fire("model_select");
	assert.equal(h.widgets.get("context-usage")?.[0], "────────── ? ?/?");
	h.ctx.getContextUsage = () => ({ percent: 0, tokens: 0, contextWindow: 1000 });
	await h.fire("session_compact");
	assert.equal(h.widgets.get("context-usage")?.[0], "────────── 0% 0/1.0k");
});

test("context bar clamps its fill to ten cells", async () => {
	const h = setup();
	for (const [percent, bar] of [[-10, "──────────"], [150, "━━━━━━━━━━"]]) {
		h.ctx.getContextUsage = () => ({ percent, tokens: 0, contextWindow: 1000 });
		await h.fire("message_end");
		assert.ok(h.widgets.get("context-usage")?.[0].startsWith(bar));
	}
});

for (const event of ["message_end", "turn_end", "agent_settled", "session_tree", "session_compact", "model_select"]) {
	test(`${event} refreshes the context widget`, async () => {
		const h = setup();
		await h.fire("session_start");
		h.ctx.getContextUsage = () => ({ percent: 80, tokens: 160000, contextWindow: 200000 });
		await h.fire(event);
		assert.equal(h.widgets.get("context-usage")?.[0], "━━━━━━━━── 80% 160k/200k");
	});
}

test("shutdown clears only its own widget and is idempotent", async () => {
	const h = setup();
	await h.fire("session_start");
	await h.fire("session_shutdown");
	await h.fire("session_shutdown");
	assert.deepEqual([...h.widgets], [["other-extension", "unchanged"]]);
});

for (const mode of ["rpc", "json", "print"]) {
	test(`${mode} performs no UI access or widget registration`, async () => {
		const h = setup(mode);
		for (const event of ["session_start", "message_end", "turn_end", "session_shutdown"]) await h.fire(event);
		assert.deepEqual(h.calls, []);
	});
}
