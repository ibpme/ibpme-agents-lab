import { DynamicBorder, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, SelectList, Spacer, Text, stripTerminalSequences } from "@earendil-works/pi-tui";
import type { ShellCommand } from "./commands.ts";
import { replyLabel, type CommandReply } from "./history.ts";

function commandLabel(command: ShellCommand, index: number): string {
	const firstLine = stripTerminalSequences(command.text.split("\n")[0])
		.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "");
	const lineCount = command.text.split("\n").length;
	return `${index + 1}. ${firstLine}${lineCount > 1 ? ` (${lineCount} lines)` : ""}`;
}

export async function selectCommand(ctx: ExtensionContext, replies: CommandReply[]): Promise<ShellCommand | undefined> {
	if (!replies.length) return undefined;
	if (ctx.mode !== "tui") return selectCommandDialog(ctx, replies);
	return ctx.ui.custom<ShellCommand | undefined>((tui, theme, _keys, done) => {
		let replyIndex = 0;
		const selections = replies.map(() => 0);
		const container = new Container();
		let list: SelectList;

		function showReply() {
			const reply = replies[replyIndex];
			container.clear();
			container.addChild(new DynamicBorder((text) => theme.fg("border", text)));
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("accent", `Copy command · ${replyLabel(reply)}`), 1, 0));
			container.addChild(new Spacer(1));
			list = new SelectList(reply.commands.map((command, index) => ({
				value: String(index), label: commandLabel(command, index),
			})), Math.max(1, Math.min(10, tui.terminal.rows - 8)), {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("dim", text),
			});
			list.setSelectedIndex(selections[replyIndex]);
			list.onSelectionChange = (item) => { selections[replyIndex] = Number(item.value); };
			list.onSelect = (item) => done(reply.commands[Number(item.value)]);
			list.onCancel = () => done(undefined);
			container.addChild(list);
			const hints = [
				replyIndex < replies.length - 1 ? "h/← older" : "",
				replyIndex > 0 ? "l/→ newer" : "",
				"↑↓ select", "Enter copy", "Esc cancel",
			].filter(Boolean).join(" · ");
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("dim", hints), 1, 0));
			container.addChild(new Spacer(1));
			container.addChild(new DynamicBorder((text) => theme.fg("border", text)));
		}
		showReply();
		return {
			render: (width) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput(data) {
				const direction = data === "h" || matchesKey(data, "left") ? 1
					: data === "l" || matchesKey(data, "right") ? -1 : 0;
				if (direction) {
					const next = Math.max(0, Math.min(replies.length - 1, replyIndex + direction));
					if (next !== replyIndex) {
						replyIndex = next;
						showReply();
					}
				} else if (matchesKey(data, "ctrl+c")) {
					done(undefined);
					return;
				} else list.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

async function selectCommandDialog(ctx: ExtensionContext, replies: CommandReply[]): Promise<ShellCommand | undefined> {
	let replyIndex = 0;
	while (replies.length) {
		const reply = replies[replyIndex];
		const labels = reply.commands.map(commandLabel);
		const options = [...labels];
		if (replyIndex < replies.length - 1) options.push("← Older reply");
		if (replyIndex > 0) options.push("→ Newer reply");
		const choice = await ctx.ui.select(`Copy command · ${replyLabel(reply)}`, options);
		if (choice === undefined) return undefined;
		if (choice === "← Older reply") replyIndex++;
		else if (choice === "→ Newer reply") replyIndex--;
		else return reply.commands[labels.indexOf(choice)];
	}
	return undefined;
}
