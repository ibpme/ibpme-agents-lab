import assert from "node:assert/strict";
import test from "node:test";
import { extensionTestHost } from "../shared/extension-test-host.ts";
import { selectCommand } from "./viewer.ts";
import type { CommandReply } from "./history.ts";

const replies: CommandReply[] = [
	{ repliesBack: 0, summary: "Newest", commands: [
		{ language: "sh", text: "echo first" },
		{ language: "bash", text: "echo second\necho third" },
	] },
	{ repliesBack: 3, summary: "Older", commands: [{ language: "bash", text: "echo old" }] },
];

test("uses native selection to navigate older and newer replies then choose a block", async () => {
	const { ctx } = extensionTestHost();
	ctx.mode = "rpc";
	let calls = 0;
	ctx.ui.select = async (title, options) => {
		calls++;
		if (calls === 1) {
			assert.match(title, /Latest reply/);
			assert.deepEqual(options, ["1. echo first", "2. echo second (2 lines)", "← Older reply"]);
			return "← Older reply";
		}
		if (calls === 2) {
			assert.match(title, /3 replies back/);
			assert.deepEqual(options, ["1. echo old", "→ Newer reply"]);
			return "→ Newer reply";
		}
		return options[1];
	};
	assert.equal(await selectCommand(ctx, replies), replies[0].commands[1]);
	assert.equal(calls, 3);
});

test("cancelling the selector returns no command", async () => {
	const { ctx } = extensionTestHost();
	ctx.mode = "rpc";
	ctx.ui.select = async () => undefined;
	assert.equal(await selectCommand(ctx, replies), undefined);
});

test("a single command still uses the selector and has no navigation rows", async () => {
	const { ctx } = extensionTestHost();
	ctx.mode = "rpc";
	ctx.ui.select = async (_title, options) => {
		assert.deepEqual(options, ["1. echo old"]);
		return options[0];
	};
	assert.equal(await selectCommand(ctx, [replies[1]]), replies[1].commands[0]);
});

for (const [older, newer] of [["h", "l"], ["\x1b[D", "\x1b[C"]]) {
	test(`TUI navigates with ${JSON.stringify([older, newer])} and remembers command selection`, async () => {
		const { ctx } = extensionTestHost();
		ctx.ui.custom = async (factory) => {
			const ui = await factory(
				{ terminal: { rows: 30 }, requestRender() {} } as any,
				ctx.ui.theme, {} as any, () => {},
			);
			ui.handleInput!(newer);
			assert.match(ui.render(100).join("\n"), /Latest reply/);
			ui.handleInput!("\x1b[B");
			ui.handleInput!(older);
			assert.match(ui.render(100).join("\n"), /3 replies back/);
			ui.handleInput!(older);
			assert.match(ui.render(100).join("\n"), /3 replies back/);
			ui.handleInput!(newer);
			assert.match(ui.render(100).join("\n"), /→ 2\. echo second/);
			return undefined as any;
		};
		await selectCommand(ctx, replies);
	});
}

test("TUI Enter returns a block and Escape cancels", async () => {
	for (const key of ["\r", "\x1b"]) {
		const { ctx } = extensionTestHost();
		let result: unknown = "not closed";
		ctx.ui.custom = async (factory) => {
			const ui = await factory(
				{ terminal: { rows: 30 }, requestRender() {} } as any,
				ctx.ui.theme, {} as any, (value) => { result = value; },
			);
			ui.handleInput!(key);
			return result as any;
		};
		assert.equal(await selectCommand(ctx, replies), key === "\r" ? replies[0].commands[0] : undefined);
	}
});
