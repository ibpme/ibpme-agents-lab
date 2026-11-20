import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";

import { rgbColor } from "@earendil-works/pi-tui";

const SEARCH_COLOR = rgbColor(106, 169, 255);
const CODEMODE_COLOR = rgbColor(245, 158, 66);
const DIRECT_COLOR = rgbColor(120, 155, 195);
const MAX_SHOWN = 6;
type Mode = "direct" | "deferred" | "codemode";
const modeColor = { direct: DIRECT_COLOR, deferred: "muted", codemode: "muted" } as const;
// Renderer/behavior overrides (such as stylish-tools) replace builtin provenance.
const BUILTIN_TOOL_NAMES = new Set(
	["read", "bash", "edit", "write", "grep", "find", "ls"].flatMap((name) => [name, `${name}_remote`]),
);
const MCP_RESOURCE_TOOLS = new Set([
	"list_mcp_resources",
	"list_mcp_resource_templates",
	"read_mcp_resource",
]);

export function toolStatuses(pi: ExtensionAPI, theme: Theme): { tools: string; mcp: string; indicators: string } {
	const all = pi.getAllTools();
	const active = pi.getActiveTools();
	const modeOf = (tool: (typeof all)[number]): Mode =>
		tool.exposure === "deferred" || tool.exposure === "codemode" ? tool.exposure : "direct";
	const visible = all.filter((tool) => tool.exposure !== "hidden" &&
		(active.includes(tool.name) || tool.exposure === "codemode" || tool.exposure === "deferred"));
	const local = visible.filter((tool) => tool.sourceInfo.source !== "builtin" && !BUILTIN_TOOL_NAMES.has(tool.name) &&
		!tool.name.startsWith("mcp__") && !MCP_RESOURCE_TOOLS.has(tool.name) &&
		tool.name !== "tool_search" && tool.name !== "codemode");
	const paint = (mode: Mode, text: string) => theme.style(text, { fg: modeColor[mode] });
	const ordered = local.map((tool) => paint(modeOf(tool), tool.name));
	const format = (prefix: string, entries: string[]) =>
		theme.fg("dim", `${prefix}:`) + (entries.slice(0, MAX_SHOWN).join(", ") || theme.fg("muted", "none")) +
		(entries.length > MAX_SHOWN ? theme.fg("dim", `, +${entries.length - MAX_SHOWN}`) : "");

	// Split mixed-exposure servers so each count has the same color as its tools.
	const servers = new Map<string, Map<Mode, number>>();
	for (const tool of visible) {
		if (!tool.name.startsWith("mcp__")) continue;
		const server = tool.namespace?.name.replace(/^mcp__/, "") ?? /^mcp__(.+?)__/.exec(tool.name)?.[1];
		if (!server) continue;
		const counts = servers.get(server) ?? new Map<Mode, number>();
		const mode = modeOf(tool);
		counts.set(mode, (counts.get(mode) ?? 0) + 1);
		servers.set(server, counts);
	}
	const entries = [...servers].sort(([a], [b]) => a.localeCompare(b)).map(([server, counts]) =>
		[...counts].map(([mode, count]) => paint(mode, `${server} (${count})`)).join("/"));
	// The command exists even with no servers or exposed tools. Do not infer
	// extension availability from resource helpers or loaded server tools.
	const mcpActive = pi.getCommands().some((command) => command.name === "mcp" && command.source === "extension");
	const indicator = theme.fg(mcpActive ? "success" : "dim", "󰌘");
	const badge = indicator + " " + theme.fg("dim", "mcp: ");
	const details = entries.length
		? entries.slice(0, MAX_SHOWN).join(" ") +
			(entries.length > MAX_SHOWN ? theme.fg("dim", ` +${entries.length - MAX_SHOWN}`) : "")
		: theme.fg("dim", "none");
	const searchIndicator = active.includes("tool_search")
		? theme.style("󰍉", { fg: SEARCH_COLOR }) + " "
		: "";
	const indicators = active.includes("codemode")
		? theme.style("  codemode", { fg: CODEMODE_COLOR })
		: theme.fg("dim", "  codemode");
	return { tools: searchIndicator + format("tools", ordered), mcp: badge + details, indicators };
}
