import { MODE_STATUS_KEY } from "../contracts/status-keys.ts";
/**
 * Mode commands, shortcut, and status indicator.
 *
 * Owns how the user drives YOLO/SAFE and how the current mode is displayed.
 * Permission state lives in the ToolSet; declarations remain owned by Pi.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Mode, ToolSet } from "./contracts.ts";
import { toolStatuses } from "../shared/tool-status.ts";

/**
 * Published as two entries so a custom footer can place the badge on its own
 * line while the tool list stays in the generic extension-status line.
 * status-line.ts hoists MODE_STATUS_KEY; everything else falls through.
 */
const TOOLS_STATUS_ID = "tools";
const MCP_STATUS_ID = "mcp-tools";

const MODE_COMMANDS: { name: string; description: string; mode: Mode }[] = [
  {
    name: "safe",
    description: "Enable SAFE execution policy (block mutations, shells, and non-read-only MCP calls)",
    mode: "safe",
  },
  {
    name: "yolo",
    description: "Enable YOLO execution policy (lift SAFE restrictions without changing tools)",
    mode: "yolo",
  },
  {
    name: "auto",
    description: "Disable safe mode (alias for /yolo)",
    mode: "yolo",
  },
];

function modeLabel(toolSet: ToolSet, ctx: ExtensionContext): string {
  const { theme } = ctx.ui;
  const badge =
    toolSet.getMode() === "safe"
      ? theme.bold(theme.fg("success", "● SAFE"))
      : theme.bold(theme.fg("error", "⏵⏵ YOLO"));

  return badge;
}

export function registerMode(pi: ExtensionAPI, toolSet: ToolSet) {
  /**
   * `ctx` is only available inside handlers, so the status can only be
   * repainted from one. Keep the most recent one and refresh whenever the tool
   * set changes -- including changes driven by /tools or the change_mode tool.
   */
  let lastCtx: ExtensionContext | undefined;

  function applyStatus(ctx: ExtensionContext) {
    lastCtx = ctx;
    ctx.ui.setStatus(MODE_STATUS_KEY, modeLabel(toolSet, ctx));
    const statuses = toolStatuses(pi, ctx.ui.theme);
    ctx.ui.setStatus(TOOLS_STATUS_ID, statuses.tools);
    ctx.ui.setStatus(MCP_STATUS_ID, statuses.mcp);
  }

  const unsubscribe = toolSet.onChange(() => {
    if (lastCtx) applyStatus(lastCtx);
  });

  pi.on("session_shutdown", async () => {
    unsubscribe();
    lastCtx = undefined;
  });

  for (const { name, description, mode } of MODE_COMMANDS) {
    pi.registerCommand(name, {
      description,
      handler: async (_args, ctx) => {
        toolSet.setMode(mode);
        applyStatus(ctx);
      },
    });
  }

  // The built-in thinking cycle is remapped to shift+right in
  // ~/.pi/agent/keybindings.json, leaving shift+tab available here.
  pi.registerShortcut("shift+tab", {
    description: "Toggle YOLO/SAFE mode",
    handler: async (ctx) => {
      toolSet.toggleMode();
      applyStatus(ctx);
    },
  });

  return applyStatus;
}
