import type { SessionEntry, ToolInfo } from "@earendil-works/pi-coding-agent";

export type Mode = "safe" | "yolo";
export const MODE_ENTRY = "tool-control-mode";

const builtInMutations = new Set(["write", "edit", "bash", "powershell"]);

export function blockedInSafe(name: string, tool?: ToolInfo): boolean {
  const readOnly = tool?.annotations?.readOnlyHint;
  return builtInMutations.has(name) || readOnly === false || (name.startsWith("mcp__") && readOnly !== true);
}

export function restoreMode(entries: readonly SessionEntry[]): Mode {
  // The latest user permission applies across all branches, including legacy sessions.
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || (entry.customType !== MODE_ENTRY && entry.customType !== "tool-set-mode")) continue;
    const data = entry.data;
    if (typeof data === "object" && data !== null && "mode" in data && (data.mode === "safe" || data.mode === "yolo")) {
      return data.mode;
    }
  }
  return "yolo";
}
