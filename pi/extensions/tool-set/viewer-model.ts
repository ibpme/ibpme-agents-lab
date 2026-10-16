import type { ToolInfo } from "@earendil-works/pi-coding-agent";
import type { ToolSet } from "./contracts.ts";

const BUILTIN_TOOL_NAMES = new Set(["read", "write", "edit", "bash", "powershell", "grep", "ls", "find"]);

export interface ToolSection {
  title: string;
  tools: ToolInfo[];
}

export function mcpServer(tool: ToolInfo): string | undefined {
  if (!tool.name.startsWith("mcp__")) return undefined;
  return tool.namespace?.name.replace(/^mcp__/, "") ?? /^mcp__(.+?)__/.exec(tool.name)?.[1];
}

export function toolDisplayName(tool: ToolInfo): string {
  return mcpServer(tool) === undefined ? tool.name : tool.name.replace(/^mcp__.+?__/, "");
}

export function groupTools(tools: ToolInfo[], active: ReadonlySet<string>): ToolSection[] {
  const builtins: ToolInfo[] = [];
  const remote: ToolInfo[] = [];
  const otherActive: ToolInfo[] = [];
  const otherInactive: ToolInfo[] = [];
  const servers = new Map<string, ToolInfo[]>();
  for (const tool of tools) {
    const server = mcpServer(tool);
    if (server !== undefined) {
      const group = servers.get(server) ?? [];
      group.push(tool);
      servers.set(server, group);
    } else if (BUILTIN_TOOL_NAMES.has(tool.name)) builtins.push(tool);
    else if (tool.name.endsWith("_remote")) remote.push(tool);
    else (active.has(tool.name) ? otherActive : otherInactive).push(tool);
  }
  return [
    { title: "Builtins", tools: builtins },
    { title: "Remote", tools: remote },
    ...Array.from(servers).sort(([a], [b]) => a.localeCompare(b)).map(([server, tools]) => ({
      title: `MCP · ${server}`,
      tools: tools.sort((a, b) => a.name.localeCompare(b.name)),
    })),
    { title: "Active", tools: otherActive },
    { title: "Inactive", tools: otherInactive },
  ].filter((section) => section.tools.length > 0);
}

export function toolStatus(
  tool: ToolInfo,
  active: ReadonlySet<string>,
  toolSet: Pick<ToolSet, "getMode" | "isBlockedInSafe">,
): { label: string; color: "success" | "dim" | "warning" } {
  if (tool.exposure === "hidden") return { label: "disabled (hidden)", color: "dim" };
  let status: { label: string; color: "success" | "dim" | "warning" };
  if (active.has(tool.name)) {
    const loaded = tool.exposure === "deferred" || tool.exposure === "codemode";
    status = { label: loaded ? `active (loaded · ${tool.exposure})` : "active", color: "success" };
  } else if (tool.exposure === "codemode") status = { label: "codemode", color: "success" };
  else if (tool.exposure === "deferred") status = { label: "deferred", color: "dim" };
  else status = { label: "inactive", color: "dim" };

  if (toolSet.getMode() === "safe" && toolSet.isBlockedInSafe(tool.name)) {
    return { label: `${status.label} · blocked (SAFE)`, color: "warning" };
  }
  return status;
}
