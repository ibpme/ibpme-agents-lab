/** Read-only `/tools` registry viewer with per-tool disclosure. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ToolSet } from "./contracts.ts";
import { groupTools, toolDetails, toolDisplayName, toolStatus } from "./viewer-model.ts";

export function registerViewer(pi: ExtensionAPI, toolSet: ToolSet) {
  pi.registerCommand("tools", {
    description: "Browse compact tool summaries; use right/left arrows to expand/collapse details (read-only)",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/tools requires TUI mode", "error");
        return;
      }
      const active = new Set(pi.getActiveTools());
      const sections = groupTools(pi.getAllTools(), active);
      const tools = sections.flatMap((section) => section.tools);
      const prompt = ctx.getSystemPromptOptions();

      await ctx.ui.custom((tui, theme, _kb, done) => {
        const expanded = new Set<string>();
        let selected = 0;
        let offset = 0;
        let viewport = 1;
        let totalLines = 0;
        let revealSelection = true;
        return {
          invalidate() {},
          render(width) {
            const fit = (line: string) => truncateToWidth(line, Math.max(1, width), "…");
            const lines: string[] = [];
            let selectedLine = 0;
            for (const section of sections) {
              lines.push(theme.fg("muted", theme.bold(`── ${section.title} ──`)));
              for (const tool of section.tools) {
                const focused = tool === tools[selected];
                if (focused) selectedLine = lines.length;
                const open = expanded.has(tool.name);
                const status = toolStatus(tool, active, toolSet);
                const heading = `${focused ? "›" : " "} ${open ? "▾" : "▸"} ${toolDisplayName(tool)}`;
                lines.push(
                  `${theme.fg(focused ? "accent" : "text", theme.bold(heading))}  ${theme.fg(status.color, status.label)}`,
                );
                if (open) {
                  for (const line of toolDetails(tool, prompt.toolSnippets?.[tool.name],
                    prompt.toolGuidelines?.[tool.name] ?? tool.promptGuidelines)) {
                    const heading = ["Description", "Arguments", "Prompt snippet", "Prompt guidelines", "Metadata"].includes(line);
                    lines.push(...wrapTextWithAnsi(line, Math.max(1, width - 4))
                      .map((part) => `    ${heading ? theme.fg("accent", theme.bold(part)) : part}`));
                  }
                }
              }
              lines.push("");
            }
            if (!tools.length) lines.push("No tools registered.");
            viewport = Math.max(1, tui.terminal.rows - 7);
            totalLines = lines.length;
            if (revealSelection) {
              if (selectedLine < offset) offset = selectedLine;
              else {
                const context = Math.min(viewport, expanded.has(tools[selected]?.name) ? 8 : 1);
                if (selectedLine + context > offset + viewport) offset = Math.max(0, selectedLine - viewport + context);
              }
              revealSelection = false;
            }
            offset = Math.max(0, Math.min(offset, totalLines - viewport));
            const body = lines.slice(offset, offset + viewport);
            const footer = "↑↓ select · → expand · ← collapse · Enter toggle · PgUp/PgDn scroll · Esc close";
            return [
              fit(`${theme.fg("accent", theme.bold("Tools"))}  ${theme.fg("dim", `${tools.length} registered · ${toolSet.getMode().toUpperCase()}`)}`),
              fit(theme.fg("border", "─".repeat(Math.max(0, width)))),
              ...body.map(fit),
              ...Array.from({ length: Math.max(0, viewport - body.length) }, () => ""),
              fit(theme.fg("border", "─".repeat(Math.max(0, width)))),
              fit(theme.fg("dim", footer)),
            ].slice(0, Math.max(0, tui.terminal.rows));
          },
          handleInput(data) {
            if (matchesKey(data, "escape") || data === "q") {
              done(undefined);
              tui.requestRender(true);
              return;
            }
            const tool = tools[selected];
            if (matchesKey(data, "right") || data === "l") {
              if (tool) expanded.add(tool.name);
              revealSelection = true;
            } else if (matchesKey(data, "left") || data === "h") {
              if (tool) expanded.delete(tool.name);
              revealSelection = true;
            } else if (matchesKey(data, "enter") || data === " " || data === "d") {
              if (tool) {
                if (expanded.has(tool.name)) expanded.delete(tool.name);
                else expanded.add(tool.name);
              }
              revealSelection = true;
            } else if (matchesKey(data, "down") || data === "j") {
              selected = Math.max(0, Math.min(tools.length - 1, selected + 1));
              revealSelection = true;
            } else if (matchesKey(data, "up") || data === "k") {
              selected = Math.max(0, selected - 1);
              revealSelection = true;
            } else if (matchesKey(data, "pageDown")) offset += viewport;
            else if (matchesKey(data, "pageUp")) offset -= viewport;
            else if (matchesKey(data, "home")) { selected = 0; revealSelection = true; }
            else if (matchesKey(data, "end")) { selected = Math.max(0, tools.length - 1); revealSelection = true; }
            tui.requestRender();
          },
        };
      });
    },
  });
}
