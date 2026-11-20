import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import contextUsage from "../extensions/context-usage/index.ts";
import { registerExtension } from "./extension-fixture.mjs";

function setup(mode = "tui", existingFactory) {
	const paints = [];
	const notices = [];
	const tui = { terminal: { rows: 24 }, requestRender() {} };
	const editorTheme = { borderColor: (text) => text };
	let factory = existingFactory;
	let editor;
	const ctx = {
		mode,
		model: { contextWindow: 272000 },
		getContextUsage: () => ({ percent: 45, tokens: 122400, contextWindow: 272000 }),
		get ui() {
			assert.equal(mode, "tui", "non-TUI modes must not access terminal UI");
			return {
				theme: { fg: (color, text) => { paints.push({ color, text }); return text; } },
				getEditorComponent: () => factory,
				setEditorComponent(next) {
					factory = next;
					editor = next?.(tui, editorTheme, {});
				},
				notify(message, level) { notices.push({ message, level }); },
			};
		},
	};
	const host = registerExtension(contextUsage);
	return {
		ctx,
		paints,
		notices,
		getFactory: () => factory,
		fire: (event) => host.fire(event, {}, ctx),
		border(width = 80) {
			const [line] = editor.render(width);
			assert.equal(visibleWidth(line), width);
			return line;
		},
	};
}

test("the context bar fills in partial cells on the right editor border", async () => {
	const h = setup();
	await h.fire("session_start");
	assert.ok(h.border().endsWith(" [█▊  ] 45% 122k/272k ──"));
	assert.deepEqual(h.paints.find(({ text }) => text === "█▊  "), { color: "warning", text: "█▊  " });
	assert.ok(h.border(39).endsWith(" 45% 122k/272k ──"));
	assert.ok(h.border(30).endsWith(" 45% ──"));
	assert.equal(h.border(24), "─".repeat(24));
});

test("context colors preserve the 40% and 70% thresholds", async () => {
	const h = setup();
	await h.fire("session_start");
	for (const [percent, color] of [[0, "success"], [40, "success"], [40.1, "warning"], [70, "warning"], [70.1, "error"]]) {
		h.ctx.getContextUsage = () => ({ percent, tokens: 100, contextWindow: 1000 });
		await h.fire("message_end");
		h.border();
		assert.deepEqual(h.paints.at(-2), { color, text: `${percent.toFixed(0)}%` });
	}
});

test("unknown utilization uses question marks and model capacity remains available", async () => {
	const h = setup();
	h.ctx.getContextUsage = () => undefined;
	await h.fire("session_start");
	assert.ok(h.border().endsWith(" [    ] ? ?/272k ──"));
	h.ctx.model = undefined;
	await h.fire("model_select");
	assert.ok(h.border().endsWith(" [    ] ? ?/? ──"));
	h.ctx.getContextUsage = () => ({ percent: 0, tokens: 0, contextWindow: 272000 });
	await h.fire("session_compact");
	assert.ok(h.border().endsWith(" [    ] 0% 0/272k ──"));
});

test("context bar clamps its fill to four cells", async () => {
	const h = setup();
	await h.fire("session_start");
	for (const [percent, bar] of [[-10, "[    ]"], [4, "[▏   ]"], [100, "[████]"], [150, "[████]"]]) {
		h.ctx.getContextUsage = () => ({ percent, tokens: 0, contextWindow: 1000 });
		await h.fire("message_end");
		assert.ok(h.border().endsWith(` ${bar} ${percent}% 0/1.0k ──`));
	}
});

for (const event of ["message_end", "turn_end", "agent_settled", "session_tree", "session_compact", "model_select"]) {
	test(`${event} refreshes the context border`, async () => {
		const h = setup();
		await h.fire("session_start");
		h.ctx.getContextUsage = () => ({ percent: 75, tokens: 204000, contextWindow: 272000 });
		await h.fire(event);
		assert.ok(h.border().endsWith(" [███ ] 75% 204k/272k ──"));
	});
}

test("shutdown clears the context editor and is idempotent", async () => {
	const h = setup();
	await h.fire("session_start");
	assert.equal(typeof h.getFactory(), "function");
	await h.fire("session_shutdown");
	await h.fire("session_shutdown");
	assert.equal(h.getFactory(), undefined);
});

test("the context border preserves another extension's editor", async () => {
	const existingFactory = () => {};
	const h = setup("tui", existingFactory);
	await h.fire("session_start");
	assert.equal(h.notices[0]?.level, "warning");
	await h.fire("session_shutdown");
	assert.equal(h.getFactory(), existingFactory);
});

for (const mode of ["rpc", "json", "print"]) {
	test(`${mode} performs no UI access`, async () => {
		const h = setup(mode);
		for (const event of ["session_start", "message_end", "turn_end", "session_shutdown"]) await h.fire(event);
		assert.equal(h.getFactory(), undefined);
	});
}
