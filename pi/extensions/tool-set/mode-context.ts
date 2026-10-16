import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerStateNotice } from "../shared/state-notice.ts";
import type { Mode, ToolSet } from "./contracts.ts";

const ENTRY_TYPE = "tool-set-mode";

/** Notices append to history; permission switches never rewrite an earlier prompt. */
export function registerModeContext(pi: ExtensionAPI, toolSet: ToolSet) {
  let restoring = false;

  registerStateNotice(pi, "tool-set-mode-context", () => toolSet.getMode() === "safe"
    ? 'Execution policy: SAFE. Tool declarations are unchanged, but write/edit and shell execution (local or remote), and MCP tools not marked read-only, are blocked. Use read-only tools; ls/grep/find and SSH tools are discoverable through tool_search or codemode. Request user approval through change_mode with mode "yolo" if blocked operations are needed.'
    : "Execution policy: YOLO. SAFE restrictions are lifted; other permission guards still apply. Tool declarations and SSH connection state are unchanged.");

  const unsubscribe = toolSet.onChange(() => {
    if (restoring) return;
    pi.appendEntry(ENTRY_TYPE, { mode: toolSet.getMode() });
  });

  pi.on("session_start", (_event, ctx) => {
    // Permissions are live session-wide user control, not branch-sensitive task state.
    // Read all entries so /tree cannot rewind approval or silently escalate to YOLO.
    let mode: Mode = "yolo";
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
      const saved = entry.data as { mode?: unknown } | undefined;
      if (saved?.mode === "safe" || saved?.mode === "yolo") mode = saved.mode;
    }
    restoring = true;
    try { toolSet.setMode(mode); } finally { restoring = false; }
  });
  pi.on("session_shutdown", () => unsubscribe());
}
