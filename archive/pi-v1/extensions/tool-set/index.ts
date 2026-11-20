/** Execution permissions and a read-only tool viewer. Pi owns the active loadout. */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerToolGuard } from "../shared/tool-guard.ts";
import { registerChangeModeTool } from "./change-mode-tool.ts";
import { registerMode } from "./mode.ts";
import { registerModeContext } from "./mode-context.ts";
import { CHANGE_MODE_TOOL, createToolSet } from "./state.ts";
import { publishToolSet } from "./service.ts";
import { registerViewer } from "./viewer.ts";

export default function toolSetExtension(pi: ExtensionAPI) {
  const toolSet = createToolSet(pi);
  const unpublish = publishToolSet(toolSet);
  pi.on("session_shutdown", async () => unpublish());

  const applyStatus = registerMode(pi, toolSet);
  registerChangeModeTool(pi, toolSet);
  registerModeContext(pi, toolSet);
  registerViewer(pi, toolSet);

  // Every call crosses this seam, including nested codemode calls. Read policy
  // live so tools discovered or registered after startup receive the same checks.
  registerToolGuard(pi, [
    {
      tools: [],
      check: (event) =>
        toolSet.getMode() === "safe" && toolSet.isBlockedInSafe(event.toolName)
          ? {
            action: "block",
            reason: `Blocked by SAFE execution policy: ${event.toolName}. Use read-only tools or request user approval through change_mode with mode "yolo".`,
          }
          : undefined,
    },
    {
      tools: [CHANGE_MODE_TOOL],
      check: () =>
        toolSet.getMode() === "yolo"
          ? {
            action: "block",
            reason: `${CHANGE_MODE_TOOL} is only available in safe mode — yolo is already the highest permission level.`,
          }
          : undefined,
    },
  ]);

  const startSession = async (_event: unknown, ctx: ExtensionContext) => {
    applyStatus(ctx);
  };

  pi.on("session_start", async (event, ctx) => {
    // Keep discovery and approval reachable even on older restored loadouts.
    // Add these once at startup; never rebuild Pi's restored selection.
    const active = pi.getActiveTools();
    const registered = new Set(pi.getAllTools().filter((tool) => tool.exposure !== "hidden").map((tool) => tool.name));
    const missing = ["codemode", "tool_search", CHANGE_MODE_TOOL].filter((name) => registered.has(name) && !active.includes(name));
    if (missing.length) pi.setActiveTools([...active, ...missing]);
    await startSession(event, ctx);
  });
  pi.on("session_tree", startSession);
}
