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

type Schema = Record<string, unknown>;

function schemaObject(value: unknown): Schema {
  return value !== null && typeof value === "object" ? value as Schema : {};
}

export function argumentType(value: unknown): string {
  const schema = schemaObject(value);
  if (Array.isArray(schema.enum)) return schema.enum.map((item) => JSON.stringify(item)).join(" | ");
  if ("const" in schema) return JSON.stringify(schema.const);
  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union)) return union.map(argumentType).join(" | ");
  if (Array.isArray(schema.allOf)) return schema.allOf.map(argumentType).join(" & ");
  if (schema.type === "array") return `Array<${argumentType(schema.items)}>`;
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  return typeof schema.type === "string" ? schema.type : schema.$ref ? String(schema.$ref).split("/").at(-1)! : "any";
}

export function toolArguments(tool: ToolInfo): { name: string; type: string; required: boolean; description: string }[] {
  const schema = schemaObject(tool.parameters);
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(schemaObject(schema.properties)).map(([name, value]) => ({
    name, type: argumentType(value), required: required.has(name),
    description: String(schemaObject(value).description ?? ""),
  }));
}

export function argumentSummary(tool: ToolInfo): string {
  const args = toolArguments(tool);
  return args.length ? args.map((arg) => `${arg.name}${arg.required ? "" : "?"}: ${arg.type}`).join(" · ") : "No arguments";
}

export function shortDescription(description: string): string {
  const text = description.replace(/\s+/g, " ").trim();
  return text.match(/^.*?[.!?](?=\s|$)/)?.[0] || text || "No description provided.";
}

export function toolDetails(
  tool: ToolInfo,
  snippet?: string,
  guidelines: readonly string[] = tool.promptGuidelines ?? [],
): string[] {
  const args = toolArguments(tool);
  return [
    "Description", tool.description || "No description provided.",
    "Arguments",
    ...(args.length ? args.map((arg) =>
      `${arg.name}: ${arg.type} (${arg.required ? "required" : "optional"})${arg.description ? ` — ${arg.description}` : ""}`,
    ) : ["No arguments."]),
    "Prompt snippet", snippet || "Not provided.",
    "Prompt guidelines", ...(guidelines.length ? guidelines.map((line) => `• ${line}`) : ["None."]),
    "Metadata",
    `Name: ${tool.name}`,
    `Exposure: ${tool.exposure}`,
    ...(tool.namespace ? [
      `Namespace: ${tool.namespace.name}`,
      ...(tool.namespace.description ? [tool.namespace.description] : []),
      ...(tool.namespace.instructions ? [tool.namespace.instructions] : []),
    ] : []),
    ...Object.entries(tool.annotations ?? {}).map(([key, value]) => `${key}: ${value}`),
    ...Object.entries(tool.sourceInfo ?? {}).map(([key, value]) => `${key}: ${value}`),
  ].flatMap((line) => line.split("\n"));
}
