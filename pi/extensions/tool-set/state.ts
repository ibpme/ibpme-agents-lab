import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Mode, ToolSet } from "./contracts.ts";

export const CHANGE_MODE_TOOL = "change_mode";

/** Execution policy only. Pi owns declarations, discovery, and loadout restoration. */
export function createToolSet(pi: ExtensionAPI): ToolSet {
  const blockedTools = new Set(["write", "edit", "bash", "powershell"]);
  let mode: Mode = "yolo";
  const listeners = new Set<() => void>();

  function setMode(next: Mode) {
    if (mode === next) return;
    mode = next;
    for (const listener of listeners) listener();
  }

  return {
    getMode: () => mode,
    setMode,
    toggleMode: () => setMode(mode === "safe" ? "yolo" : "safe"),
    addBlockedTools(names) {
      for (const name of names) blockedTools.add(name);
    },
    isBlockedInSafe(name) {
      if (blockedTools.has(name)) return true;
      if (!name.startsWith("mcp__")) return false;
      return pi.getAllTools().find((tool) => tool.name === name)?.annotations?.readOnlyHint !== true;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
