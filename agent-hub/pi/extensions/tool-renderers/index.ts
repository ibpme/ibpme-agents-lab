import { stripVTControlCharacters } from "node:util";
import type { ExtensionAPI, ToolRenderers, ToolRendererResolver } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { colorJson, hubTitle } from "../contracts/presentation.ts";

type RecordValue = Record<string, unknown>;
type Theme = Parameters<NonNullable<ToolRenderers["renderCall"]>>[1];
type Tone = "accent" | "muted" | "success" | "warning" | "error" | "toolTitle";
interface Row { text: string | ((theme: Theme) => string); tone: Tone }

const titles = {
  list_agents: "Live agents",
  send_message: "Send message",
  spawn_agent: "Spawn agent",
  list_agent_tasks: "Agent tasks",
  agent_task: "Agent task",
} as const;
type Tool = keyof typeof titles;

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}

function clean(value: unknown): string {
  return stripVTControlCharacters(String(value ?? ""))
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u2028\u2029]/g, " ");
}

function inline(value: unknown): string {
  return clean(value).replace(/\s+/g, " ").trim();
}

function preview(value: unknown): string {
  return truncateToWidth(inline(value), 100);
}

function json(value: unknown): string {
  return clean(JSON.stringify(value, null, 2) ?? "null");
}

function panel(rows: Row[], theme: Theme, wrap = false, outputPad = 0): Component {
  return {
    invalidate() {},
    render(width) {
      if (width <= 0) return [];
      const pad = Math.min(Math.max(0, outputPad), Math.floor((width - 1) / 2));
      const available = width - pad * 2;
      return rows.flatMap(row => {
        const text = typeof row.text === "function" ? row.text(theme) : theme.fg(row.tone, row.text);
        const lines = wrap ? wrapTextWithAnsi(text, available) : [truncateToWidth(text, available)];
        return lines.map(line => " ".repeat(pad) + truncateToWidth(line, available));
      });
    },
  };
}

function statusTone(value: unknown): Tone {
  if (["failed", "interrupted", "lost", "unavailable"].includes(String(value))) return "error";
  if (["completed", "accepted", "idle"].includes(String(value))) return "success";
  return "warning";
}

function taskRow(task: RecordValue): Row {
  return { text: theme => {
    const parts = [theme.fg("accent", inline(task.task_id ?? "Unknown task")), theme.fg(statusTone(task.status), inline(task.status ?? "unknown"))];
    if (task.agent_id) parts.push(theme.fg("accent", inline(task.agent_id)));
    if (task.cwd) parts.push(theme.fg("muted", inline(task.cwd)));
    return "  " + parts.join(theme.fg("dim", " · "));
  }, tone: "muted" };
}

function summary(tool: Tool, data: RecordValue): Row[] {
  const error = record(data.error);
  if (data.error) return [{ text: `✕ ${inline(error?.code ?? "Error")} · ${inline(error?.message ?? data.error)}`, tone: "error" }];
  if (tool === "list_agents" && Array.isArray(data.agents)) {
    const agents = data.agents.map(record).filter((agent): agent is RecordValue => !!agent);
    const rows: Row[] = [{ text: `${agents.length} live agent${agents.length === 1 ? "" : "s"}`, tone: "accent" }];
    for (const agent of agents.slice(0, 4)) {
      const self = agent.agent_id === data.self_agent_id ? " (you)" : "";
      const identity = agent.name || agent.agent_id || "Unknown agent";
      rows.push({ text: theme => "  " + theme.fg("accent", inline(identity)) + theme.fg("dim", self)
        + theme.fg("dim", " · ") + theme.fg(statusTone(agent.activity), inline(agent.activity ?? "unknown"))
        + theme.fg("dim", " · ") + theme.fg(agent.can_receive_messages === true ? "success" : "warning", agent.can_receive_messages === true ? "listening" : "not ready")
        + theme.fg("dim", " · ") + theme.fg("muted", inline(agent.cwd)), tone: "muted" });
    }
    if (agents.length > 4) rows.push({ text: `  +${agents.length - 4} more agents`, tone: "muted" });
    return rows;
  }
  if (tool === "list_agent_tasks" && Array.isArray(data.tasks)) {
    const tasks = data.tasks.map(record).filter((task): task is RecordValue => !!task);
    return [
      { text: `${tasks.length} task${tasks.length === 1 ? "" : "s"}`, tone: "accent" },
      ...tasks.slice(0, 4).map(taskRow),
      ...(tasks.length > 4 ? [{ text: `  +${tasks.length - 4} more tasks`, tone: "muted" as const }] : []),
    ];
  }
  if (tool === "send_message" && typeof data.status === "string") {
    return [{ text: theme => theme.fg(statusTone(data.status), data.status === "accepted" ? "✓ Queued (not yet answered)" : inline(data.status))
      + theme.fg("dim", " → ") + theme.fg("accent", inline(data.agent_id)), tone: "muted" }];
  }
  if ((tool === "spawn_agent" || tool === "agent_task") && typeof data.task_id === "string") {
    const rows = [taskRow(data)];
    rows.push({ text: theme => theme.fg("muted", "  Messaging: ")
      + theme.fg(data.can_receive_messages === true ? "success" : "warning", data.can_receive_messages === true ? "ready" : "not ready")
      + (data.process_state ? theme.fg("dim", " · ") + theme.fg("muted", "Process: ") + theme.fg(data.process_state === "available" ? "success" : statusTone(data.process_state), inline(data.process_state)) : ""), tone: "muted" });
    const answer = record(data.answer);
    if (answer?.text) rows.push({ text: theme => theme.fg("accent", "  Answer: ") + theme.fg("muted", preview(answer.text)), tone: "muted" });
    if (answer?.error || data.delivery_error) rows.push({ text: `  ${preview(answer?.error ?? data.delivery_error)}`, tone: "error" });
    return rows;
  }
  return [{ text: preview(JSON.stringify(data)), tone: "muted" }];
}

function renderers(tool: Tool): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(args, theme, context) {
      const input = record(args) ?? {};
      const detail = tool === "send_message" ? `→ ${inline(input.agent_id)}`
        : tool === "spawn_agent" ? [input.name, input.harness, input.cwd].filter(Boolean).map(inline).join(" · ")
        : tool === "agent_task" ? [input.action, input.task_id].filter(Boolean).map(inline).join(" · ") : "";
      const rows: Row[] = [{ text: theme => hubTitle(theme, titles[tool], detail), tone: "toolTitle" }];
      if (context.expanded) {
        rows.push({ text: "Arguments", tone: "accent" }, { text: theme => colorJson(json(input), theme), tone: "muted" });
      } else if (input.message || input.prompt) {
        rows.push({ text: `  ${preview(input.message ?? input.prompt)}`, tone: "muted" });
      }
      return panel(rows, theme, context.expanded, context.outputPad);
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      // Pi passes content and details to renderers, not MCP structuredContent.
      const text = result.content.filter(block => block.type === "text").map(block => block.text).join("\n");
      let data: RecordValue | undefined;
      try { data = record(JSON.parse(text)); } catch { /* Notifications and transport errors can be plain text. */ }
      const failed = context.isError || !!data?.error;
      const rows: Row[] = isPartial
        ? [{ text: "◌ Working…", tone: "warning" }]
        : data ? summary(tool, data) : [{ text: preview(text) || "No text output", tone: "muted" }];
      if (failed && !data?.error) rows.unshift({ text: "✕ Tool failed", tone: "error" });
      if (expanded) {
        rows.push({ text: "Result", tone: "accent" }, { text: data ? theme => colorJson(json(data), theme) : clean(text), tone: "muted" });
        for (const block of result.content) {
          if (block.type !== "text") rows.push({ text: `[${inline(block.type)} content]`, tone: "muted" });
        }
        const details = record(result.details);
        if (details?.fullOutputPath) rows.push({ text: `Full output: ${inline(details.fullOutputPath)}`, tone: "muted" });
      } else if (!isPartial) {
        rows.push({ text: "  Expand for full arguments and result", tone: "muted" });
      }
      return panel(rows, theme, expanded, context.outputPad);
    },
  };
}

export const resolveAgentToolRenderer: ToolRendererResolver = (toolName, next) => {
  const match = /^mcp__(?:agent_hub|agents)__(list_agents|send_message|spawn_agent|list_agent_tasks|agent_task)$/.exec(toolName);
  return match ? renderers(match[1] as Tool) : next();
};

export default function agentToolRenderers(pi: ExtensionAPI): void {
  pi.registerToolRenderer(resolveAgentToolRenderer);
}
