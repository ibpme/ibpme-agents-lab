import { copyToClipboard, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { commandReplies, replyLabel } from "./history.ts";
import { pickBlock } from "./picker.ts";

export async function copyCommand(args: string, ctx: ExtensionCommandContext, copy = copyToClipboard): Promise<void> {
  if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")) return;

  const requested = args.trim();
  const blockNumber = Number(requested);
  if (requested && (!/^[1-9]\d*$/.test(requested) || !Number.isSafeInteger(blockNumber))) {
    ctx.ui.notify("Usage: /copy-command [number in newest reply with commands]", "error");
    return;
  }

  const replies = commandReplies(ctx.sessionManager.getBranch());
  const newest = replies[0];
  if (!newest) {
    ctx.ui.notify("No fenced shell commands found on this session branch", "info");
    return;
  }

  const block = requested ? newest.blocks[blockNumber - 1] : await pickBlock(ctx, replies);
  if (block === undefined) {
    if (requested) {
      ctx.ui.notify(`Choose a block from 1 to ${newest.blocks.length} in ${replyLabel(newest).toLowerCase()}`, "error");
    }
    return;
  }

  if (ctx.mode === "rpc") {
    await ctx.ui.editor("Copy command block", block);
    return;
  }

  try {
    await copy(block);
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : "Clipboard unavailable", "error");
    return;
  }
  ctx.ui.notify("Copied command block to clipboard", "info");
}

export default function copyCommandExtension(pi: ExtensionAPI): void {
  pi.registerCommand("copy-command", {
    description: "Pick a shell command to copy from assistant replies",
    handler: copyCommand,
  });
}
