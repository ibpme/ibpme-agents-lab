import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import { matchesKey, rgbColor, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { blockedInSafe, type Mode } from "./policy.ts";

const builtIns = new Set(["read", "write", "edit", "bash", "powershell", "grep", "find", "ls"]);
const toolListExclusions = new Set([
  "codemode", "tool_search", "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource",
]);
const codemodeColor = rgbColor(245, 158, 66);
const codemodeLabel = "  codemode";
const searchColor = rgbColor(106, 169, 255);

function mcpServer(tool: ToolInfo): string | undefined {
  if (!tool.name.startsWith("mcp__")) return;
  return tool.namespace?.name.replace(/^mcp__/, "") ?? /^mcp__(.+?)__/.exec(tool.name)?.[1];
}

function groupTools(tools: ToolInfo[]): Map<string, ToolInfo[]> {
  const groups = new Map<string, ToolInfo[]>([["Built-in tools", []], ["Extensions", []]]);
  for (const tool of tools) {
    const server = mcpServer(tool);
    const name = server ? `MCP · ${server}` : builtIns.has(tool.name) ? "Built-in tools" : tool.namespace?.name ?? "Extensions";
    const group = groups.get(name) ?? [];
    group.push(tool);
    groups.set(name, group);
  }
  return groups;
}

function reachability(tool: ToolInfo, active: ReadonlySet<string>): string {
  const exposure = tool.exposure === "model-only" ? "model only" : tool.exposure;
  if (exposure === "hidden") return exposure;
  if (active.has(tool.name)) return exposure === "direct" ? "active" : `active · ${exposure}`;
  return exposure === "deferred" || exposure === "codemode" ? exposure : "inactive";
}

function schemaObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function schemaType(value: unknown): string {
  const schema = schemaObject(value);
  if ("const" in schema) return JSON.stringify(schema.const) ?? "any";
  if (Array.isArray(schema.enum)) return schema.enum.map((item) => JSON.stringify(item)).join(" | ");
  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union)) return union.map(schemaType).join(" | ");
  if (Array.isArray(schema.allOf)) return schema.allOf.map(schemaType).join(" & ");
  if (schema.type === "array" && schema.items) return `Array<${schemaType(schema.items)}>`;
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  if (typeof schema.type === "string") return schema.type;
  return typeof schema.$ref === "string" ? schema.$ref.split("/").at(-1) || "any" : "any";
}

function toolDetails(tool: ToolInfo, prompt: ReturnType<ExtensionCommandContext["getSystemPromptOptions"]>): string[] {
  const parameters = schemaObject(tool.parameters);
  const properties = Object.entries(schemaObject(parameters.properties));
  const required = Array.isArray(parameters.required) ? new Set(parameters.required) : new Set();
  const argumentsList = properties.map(([name, schema]) => {
    const { description } = schemaObject(schema);
    return `${name}${required.has(name) ? "" : "?"}  ${schemaType(schema)}${typeof description === "string" && description ? ` · ${description}` : ""}`;
  });
  const snippet = prompt.toolSnippets?.[tool.name];
  const guidelines = prompt.toolGuidelines?.[tool.name] ?? tool.promptGuidelines ?? [];
  return [
    tool.description,
    "",
    "Arguments",
    ...(argumentsList.length ? argumentsList : ["No arguments"]),
    ...(snippet ? ["", "Prompt snippet", snippet] : []),
    ...(guidelines.length ? ["", "Prompt guidelines", ...guidelines] : []),
    "",
    "Metadata",
    tool.name,
    `Exposure · ${tool.exposure}`,
    ...(tool.namespace ? [`Namespace · ${tool.namespace.name}`, tool.namespace.description, tool.namespace.instructions].filter((line) => line !== undefined) : []),
    ...Object.entries(tool.annotations ?? {}).map(([key, value]) => `${key} · ${value}`),
    ...Object.entries(tool.sourceInfo ?? {}).map(([key, value]) => `${key} · ${value}`),
  ].flatMap((line) => line.split("\n"));
}

export function updateToolStatuses(pi: ExtensionAPI, ctx: ExtensionContext, published: Map<string, string>): void {
  const ui = ctx.ui;
  const { theme } = ui;
  const publish = (key: string, value: string) => {
    if (published.get(key) === value) return;
    ui.setStatus(key, value);
    published.set(key, value);
  };
  const active = new Set(pi.getActiveTools());
  publish("codemode", active.has("codemode")
    ? theme.style(codemodeLabel, { fg: codemodeColor })
    : theme.fg("dim", codemodeLabel));
  const extensions: string[] = [];
  const servers = new Map<string, number>();
  for (const tool of pi.getAllTools()) {
    if (tool.exposure === "hidden" || (!active.has(tool.name) && !["deferred", "codemode"].includes(tool.exposure))) continue;
    const server = mcpServer(tool);
    if (server) servers.set(server, (servers.get(server) ?? 0) + 1);
    else if (tool.sourceInfo.source !== "builtin" && !builtIns.has(tool.name) &&
      !toolListExclusions.has(tool.name)) extensions.push(tool.name);
  }

  const summarize = (names: string[]) => {
    const visible = names.slice(0, 6).join(", ") || "none";
    return theme.fg("muted", names.length > 6 ? `${visible}, +${names.length - 6}` : visible);
  };
  const searchIcon = active.has("tool_search") ? theme.style("󰍉", { fg: searchColor }) + " " : "";
  publish("tools", searchIcon + theme.fg("dim", "tools: ") + summarize(extensions));

  const mcpAvailable = pi.getCommands().some(({ name, source }) => name === "mcp" && source === "extension");
  const mcpIcon = theme.fg(mcpAvailable ? "success" : "dim", "󰌘");
  const serverCounts = [...servers].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => `${name} (${count})`);
  publish("mcp-tools", mcpIcon + " " + theme.fg("dim", "mcp: ") + summarize(serverCounts));
}

export function registerViewer(pi: ExtensionAPI, getMode: () => Mode): void {
  pi.registerCommand("tools", {
    description: "Inspect tools, arguments, and execution permissions",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        if (ctx.hasUI) ctx.ui.notify("/tools requires the terminal UI.", "warning");
        return;
      }
      const active = new Set(pi.getActiveTools());
      const groups = groupTools(pi.getAllTools());
      const tools = [...groups.values()].flat();
      const prompt = ctx.getSystemPromptOptions();

      await ctx.ui.custom<void>((tui, theme, _keys, done) => {
        const expanded = new Set<string>();
        let selected = 0;
        let offset = 0;
        let pageSize = 1;
        let reveal = true;

        return {
          capturesViewportInput: true,
          invalidate() {},
          render(width) {
            if (width < 1) return [];
            const mode = getMode();
            const lines: string[] = [];
            let selectedLine = 0;
            for (const [label, group] of groups) {
              if (!group.length) continue;
              if (lines.length) lines.push("");
              lines.push(theme.fg("muted", theme.bold(`── ${label} ──`)));
              for (const tool of group) {
                const focused = tool === tools[selected];
                if (focused) selectedLine = lines.length;
                const open = expanded.has(tool.name);
                const blocked = mode === "safe" && blockedInSafe(tool.name, tool);
                const name = mcpServer(tool) ? tool.name.replace(/^mcp__.+?__/, "") : tool.name;
                const marker = `${focused ? "›" : " "} ${open ? "▾" : "▸"}`;
                const status = reachability(tool, active) + (blocked ? " · blocked (SAFE)" : "");
                lines.push(theme.fg(focused ? "accent" : "text", theme.bold(`${marker} ${name}`)) +
                  "  " + theme.fg(blocked ? "warning" : "muted", status));
                if (open) {
                  for (const line of toolDetails(tool, prompt)) {
                    lines.push(...wrapTextWithAnsi(line, Math.max(1, width - 4)).map((part) => `    ${part}`));
                  }
                }
              }
            }
            if (!lines.length) lines.push("No tools registered.");

            const rows = Math.max(1, tui.terminal.rows);
            pageSize = Math.max(1, rows - 7);
            if (reveal) {
              const context = Math.min(pageSize, expanded.has(tools[selected]?.name) ? 5 : 1);
              if (selectedLine < offset) offset = selectedLine;
              if (selectedLine + context > offset + pageSize) offset = selectedLine + context - pageSize;
              reveal = false;
            }
            offset = Math.max(0, Math.min(offset, lines.length - pageSize));
            const title = theme.fg("accent", theme.bold("Tools")) + theme.fg("muted", `  ${tools.length} registered · ${mode.toUpperCase()}`);
            const footer = theme.fg("dim", "↑↓ select · ←→ details · PgUp/PgDn scroll · Esc close");
            const body = lines.slice(offset, offset + pageSize);
            return [title, ...body, footer].slice(0, rows).map((line) => truncateToWidth(line, width));
          },
          handleInput(data) {
            if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") {
              done();
              tui.requestRender(true);
              return;
            }
            if (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) {
              offset += matchesKey(data, "pageUp") ? -pageSize : pageSize;
            } else {
              const name = tools[selected]?.name;
              if (matchesKey(data, "up") || data === "k") selected = Math.max(0, selected - 1);
              else if (matchesKey(data, "down") || data === "j") selected = Math.min(Math.max(0, tools.length - 1), selected + 1);
              else if (matchesKey(data, "home")) selected = 0;
              else if (matchesKey(data, "end")) selected = Math.max(0, tools.length - 1);
              else if (name && (matchesKey(data, "right") || data === "l")) expanded.add(name);
              else if (name && (matchesKey(data, "left") || data === "h")) expanded.delete(name);
              else if (name && (matchesKey(data, "enter") || data === " ")) {
                if (expanded.has(name)) expanded.delete(name);
                else expanded.add(name);
              } else return;
              reveal = true;
            }
            tui.requestRender();
          },
        };
      });
    },
  });
}
