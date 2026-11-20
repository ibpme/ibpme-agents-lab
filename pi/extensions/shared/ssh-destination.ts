import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";
import { sanitizeTerminalText } from "./terminal-text.ts";

export function withSshDestination<T extends TSchema>(
  render: ToolDefinition<T, any>["renderResult"],
): NonNullable<ToolDefinition<T, any>["renderResult"]> {
  return (result, options, theme, context) => {
    const destination = result.details?.sshDestination;
    const fallback = () => new Text(result.content.filter((block) => block.type === "text")
      .map((block) => block.text).join("\n"), 0, 0);
    if (typeof destination !== "string") return render?.(result, options, theme, context) ?? fallback();
    const container = new Container();
    container.addChild(new Text(theme.fg("accent", "SSH " + sanitizeTerminalText(destination)), 0, 0));
    container.addChild(render && !result.isError && !context.isError
      ? render(result, options, theme, { ...context, lastComponent: undefined })
      : fallback());
    return container;
  };
}
