import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

export function modelSegments(ctx: ExtensionContext, pi: ExtensionAPI, theme: Theme) {
  return {
    model(): string {
      const label = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no-model";
      return theme.fg("accent", theme.bold(label));
    },
    thinking(): string {
      if (!ctx.model?.reasoning) return "";
      const level = pi.getThinkingLevel();
      return theme.getThinkingBorderColor(level)(level);
    },
  };
}
