import { DynamicBorder, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, SelectList, Spacer, stripTerminalSequences, Text } from "@earendil-works/pi-tui";
import { replyLabel, type CommandReply } from "./history.ts";

function blockLabel(block: string, index: number): string {
  const lines = block.split("\n");
  const preview = stripTerminalSequences(lines.find((line) => line.trim()) ?? "")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "");
  return `${index + 1}. ${preview}${lines.length > 1 ? ` (${lines.length} lines)` : ""}`;
}

export function pickBlock(ctx: ExtensionCommandContext, replies: CommandReply[]): Promise<string | undefined> {
  if (ctx.mode === "rpc") return pickInDialog(ctx, replies);

  return ctx.ui.custom<string | undefined>((tui, theme, _keys, done) => {
    let replyIndex = 0;
    const selections = replies.map(() => 0);
    const container = new Container();
    const border = () => new DynamicBorder((text) => theme.fg("border", text));
    let list: SelectList;

    function showReply() {
      const reply = replies[replyIndex];
      list = new SelectList(reply.blocks.map((block, index) => ({
        value: String(index), label: blockLabel(block, index),
      })), Math.max(1, Math.min(10, tui.terminal.rows - 8)), {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("dim", text),
      });
      list.setSelectedIndex(selections[replyIndex]);
      list.onSelectionChange = ({ value }) => { selections[replyIndex] = Number(value); };
      list.onSelect = ({ value }) => done(reply.blocks[Number(value)]);
      list.onCancel = () => done(undefined);

      const hints = [
        replyIndex < replies.length - 1 ? "h/← older" : "",
        replyIndex > 0 ? "l/→ newer" : "",
        "↑↓ select", "Enter copy", "Esc cancel",
      ].filter(Boolean).join(" · ");
      container.clear();
      container.addChild(border());
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("accent", `Copy command · ${replyLabel(reply)}`), 1, 0));
      container.addChild(new Spacer(1));
      container.addChild(list);
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("dim", hints), 1, 0));
      container.addChild(new Spacer(1));
      container.addChild(border());
    }

    showReply();
    return {
      capturesViewportInput: true,
      render: (width) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput(data) {
        if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
          done(undefined);
          return;
        }

        const direction = data === "h" || matchesKey(data, "left") ? 1
          : data === "l" || matchesKey(data, "right") ? -1 : 0;
        if (direction === 0) list.handleInput(data);
        else {
          const next = replyIndex + direction;
          if (next < 0 || next >= replies.length) return;
          replyIndex = next;
          showReply();
        }
        tui.requestRender();
      },
    };
  });
}

async function pickInDialog(ctx: ExtensionCommandContext, replies: CommandReply[]): Promise<string | undefined> {
  let replyIndex = 0;
  const older = "← Older reply";
  const newer = "→ Newer reply";
  while (true) {
    const reply = replies[replyIndex];
    const labels = reply.blocks.map(blockLabel);
    const options = [...labels];
    const canGoOlder = replyIndex < replies.length - 1;
    const canGoNewer = replyIndex > 0;
    if (canGoOlder) options.push(older);
    if (canGoNewer) options.push(newer);

    const choice = await ctx.ui.select(`Copy command · ${replyLabel(reply)}`, options);
    if (choice === older && canGoOlder) replyIndex++;
    else if (choice === newer && canGoNewer) replyIndex--;
    else return choice === undefined ? undefined : reply.blocks[labels.indexOf(choice)];
  }
}
