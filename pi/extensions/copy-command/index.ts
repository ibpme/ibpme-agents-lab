import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ShellCommand } from "./commands.ts";
import { selectCommand } from "./viewer.ts";
import { copyToClipboard } from "./clipboard.ts";
import { commandReplies, replyLabel } from "./history.ts";

export default function copyCommandExtension(pi: ExtensionAPI) {
	pi.registerCommand("copy-command", {
		description: "Pick a shell command to copy from assistant replies",
		handler: async (args, ctx) => {
			const requested = args.trim();
			if (requested && (!/^[1-9]\d*$/.test(requested) || !Number.isSafeInteger(Number(requested)))) {
				ctx.ui.notify("Usage: /copy-command [number in newest reply with commands]", "error");
				return;
			}
			const replies = commandReplies(ctx.sessionManager.getBranch());
			if (!replies.length) {
				ctx.ui.notify("No fenced shell commands found on this session branch.", "info");
				return;
			}
			let command: ShellCommand | undefined;
			if (requested) {
				command = replies[0].commands[Number(requested) - 1];
				if (!command) {
					ctx.ui.notify(`Choose a block from 1 to ${replies[0].commands.length} in ${replyLabel(replies[0]).toLowerCase()}.`, "error");
					return;
				}
			} else if (ctx.hasUI) {
				command = await selectCommand(ctx, replies);
			} else {
				ctx.ui.notify("Use /copy-command <number> to copy a block from the newest reply with commands.", "info");
				return;
			}
			if (!command) return;
			if (!copyToClipboard(command.text)) {
				ctx.ui.notify("Could not access the clipboard. Linux needs wl-copy, xclip, or xsel and a desktop session; macOS needs pbcopy; Windows needs clip.exe. Remote sessions copy on the remote host.", "error");
				return;
			}
			ctx.ui.notify("Copied command block to clipboard (not executed).", "info");
		},
	});
}
