import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function thinkingCycleBackward(pi: ExtensionAPI): void {
  pi.registerShortcut("shift+down", {
    description: "Cycle thinking level backward",
    handler: (ctx) => {
      if (!ctx.model?.reasoning) {
        if (ctx.hasUI) ctx.ui.notify("Current model does not support thinking", "info");
        return;
      }

      const levels = getSupportedThinkingLevels(ctx.model);
      if (levels.length === 0) return;
      const currentIndex = levels.indexOf(pi.getThinkingLevel());
      const previousIndex = currentIndex <= 0 ? levels.length - 1 : currentIndex - 1;
      pi.setThinkingLevel(levels[previousIndex]);
      if (ctx.hasUI) ctx.ui.notify(`Thinking level: ${pi.getThinkingLevel()}`, "info");
    },
  });
}
