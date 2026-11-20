import assert from "node:assert/strict";
import test from "node:test";
import stash from "../extensions/stash/index.ts";
import { registerExtension } from "./extension-fixture.mjs";

function setup() {
	const host = registerExtension(stash);
	let draft = "";
	const notices = [];
	const ctx = {
		mode: "tui",
		ui: {
			getEditorText: () => draft,
			setEditorText: (text) => { draft = text; },
			notify: (text) => notices.push(text),
			setStatus: () => assert.fail("stash must not add a footer status"),
		},
	};
	assert.deepEqual([...host.shortcuts.keys()], ["ctrl+s"]);
	return {
		ctx,
		notices,
		toggle: () => host.shortcuts.get("ctrl+s").handler(ctx),
		fire: (name, event = {}) => host.fire(name, event, ctx),
		get draft() { return draft; },
		set draft(text) { draft = text; },
	};
}

test("stash preserves exact multiline text and restores after an interactive prompt settles", async () => {
	const h = setup();
	const original = "  original\n😀 draft\n";
	h.draft = original;
	await h.toggle();
	assert.equal(h.draft, "");
	await h.fire("agent_settled");
	assert.equal(h.draft, "");
	for (const source of ["extension", "rpc"]) {
		await h.fire("input", { source });
		await h.fire("agent_settled");
		assert.equal(h.draft, "");
	}
	await h.fire("input", { source: "interactive" });
	assert.equal(h.draft, "");
	await h.fire("agent_settled");
	assert.equal(h.draft, original);
});

test("manual restore swaps drafts without losing either", async () => {
	const h = setup();
	h.draft = "original";
	await h.toggle();
	h.draft = "replacement";
	await h.toggle();
	assert.equal(h.draft, "original");
	await h.toggle();
	assert.equal(h.draft, "replacement");
	h.draft = "";
	await h.toggle();
	assert.equal(h.draft, "original");
	await h.toggle();
	assert.equal(h.draft, "");
});

test("automatic restore never overwrites a new draft and leaves the stash recoverable", async () => {
	const h = setup();
	h.draft = "saved";
	await h.toggle();
	await h.fire("input", { source: "interactive" });
	h.draft = "new draft";
	await h.fire("agent_settled");
	assert.equal(h.draft, "new draft");
	h.draft = "";
	await h.fire("input", { source: "extension" });
	await h.fire("agent_settled");
	assert.equal(h.draft, "");
	h.draft = "new draft";
	await h.toggle();
	assert.equal(h.draft, "saved");
	await h.fire("agent_settled");
	assert.equal(h.draft, "saved");
	await h.toggle();
	assert.equal(h.draft, "new draft");
});

test("empty stash is a no-op and restoring consumes the saved draft", async () => {
	const h = setup();
	await h.toggle();
	assert.equal(h.draft, "");
	assert.equal(h.notices.at(-1), "No prompt to stash");
	h.draft = "saved";
	await h.toggle();
	await h.toggle();
	assert.equal(h.draft, "saved");
	h.draft = "";
	await h.toggle();
	assert.equal(h.draft, "");
});

for (const event of ["session_start", "session_shutdown"]) {
	test(`${event} clears stash and pending automatic restore`, async () => {
		const h = setup();
		h.draft = "saved";
		await h.toggle();
		await h.fire("input", { source: "interactive" });
		await h.fire(event);
		await h.fire("agent_settled");
		await h.toggle();
		assert.equal(h.draft, "");
	});
}

test("non-TUI modes do not touch editor or notification methods", async () => {
	const h = setup();
	h.draft = "saved";
	await h.toggle();
	for (const mode of ["rpc", "json", "print"]) {
		h.ctx.mode = mode;
		h.ctx.ui = new Proxy({}, { get: () => assert.fail(`UI accessed in ${mode}`) });
		await h.toggle();
		await h.fire("input", { source: "interactive" });
		await h.fire("agent_settled");
	}
});
