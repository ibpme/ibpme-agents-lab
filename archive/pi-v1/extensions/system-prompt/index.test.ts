import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { initTheme, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { extensionTestHost } from "../shared/extension-test-host.ts";
import extension from "./index.ts";

function setup(fullPrompt: string, appendPrompt?: string) {
	const host = extensionTestHost();
	extension(host.pi);
	const ctx = host.ctx as ExtensionCommandContext;
	ctx.getSystemPrompt = () => fullPrompt;
	ctx.getSystemPromptOptions = () => ({ cwd: ctx.cwd, appendSystemPrompt: appendPrompt });
	const command = host.commands.get("system-prompt")!;
	return { ctx, run: (args = "") => command.handler(args, ctx) };
}

for (const mode of ["", "append"]) {
	test(`renders Markdown in ${mode || "default"} mode`, async () => {
		initTheme("dark", false);
		const h = setup("Base **instructions**.\n\nAppend **guidelines**.", "Append **guidelines**.");
		let rendered = "";
		h.ctx.ui.custom = async (factory) => {
			const component = await factory(
				{ terminal: { rows: 40 }, requestRender() {} } as any,
				h.ctx.ui.theme,
				{} as any,
				() => {},
			);
			rendered = component.render(100).map(stripVTControlCharacters).join("\n");
			return undefined as any;
		};
		await h.run(mode);
		assert.ok(rendered.includes("Append guidelines."), rendered);
		assert.ok(!rendered.includes("**"), rendered);
		if (!mode) {
			assert.ok(rendered.includes("Base instructions."), rendered);
			assert.equal(rendered.split("Append guidelines.").length - 1, 1);
		} else {
			assert.ok(!rendered.includes("Base instructions."), rendered);
		}
	});
}

test("keeps raw Markdown in the non-TUI fallback", async (t) => {
	const h = setup("Base **instructions**.");
	h.ctx.mode = "rpc";
	const output: unknown[] = [];
	t.mock.method(console, "log", (...args: unknown[]) => output.push(...args));
	await h.run();
	assert.ok(output.includes("--- System Prompt ---\n\nBase **instructions**."));
});
