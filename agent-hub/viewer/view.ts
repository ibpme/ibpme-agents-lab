import { homedir } from "node:os";
import type { BrowserTheme, BrowserTone } from "./theme.ts";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { AgentSnapshot, RegistryView } from "./reader.ts";
import type { Origin, PaneAction } from "./tmux-actions.ts";

export const clean = (value: string): string => value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
export const agentKey = (agent: AgentSnapshot): string => `${agent.harness}:${agent.process.pid}:${agent.process.startedAt}`;
export const recentAgent = (agent: AgentSnapshot): boolean => agent.observedAt <= Date.now() + 5000 && Date.now() - agent.observedAt <= 30_000;

export function paneActionReason(view: RegistryView, agent: AgentSnapshot, origin: Origin | undefined, action: PaneAction): string | undefined {
  if (view.state === "stale" || view.state === "unavailable" || !recentAgent(agent)) return "Registry observations are stale; refresh before taking actions.";
  if (!origin) return "Pane actions require tmux.";
  if (agent.session.mode !== "interactive" || !agent.pane) return "No interactive tmux pane for this agent.";
  if (agent.pane.server !== origin.server) return "Agent is on another tmux server (read-only).";
  if (agent.pane.id === origin.paneId && action !== "attach") return "Cannot move or kill the current pane.";
  return undefined;
}

export function isCurrentAgent(agent: AgentSnapshot, origin?: Origin): boolean {
  return (agent.harness === "pi" && agent.process.pid === process.pid) ||
    !!(agent.pane && origin && agent.pane.server === origin.server && agent.pane.id === origin.paneId);
}

export function agentGroup(agent: AgentSnapshot, origin?: Origin): string {
  if (isCurrentAgent(agent, origin)) return "Current session";
  return agent.session.mode === "interactive" && agent.pane ? "Interactive (tmux)" : "Non-tmux";
}

export function sortAgents(agents: AgentSnapshot[], origin?: Origin): AgentSnapshot[] {
  const groups = ["Current session", "Interactive (tmux)", "Non-tmux"];
  const states = ["waiting", "busy", "idle", "unknown"];
  return [...agents].sort((a, b) =>
    groups.indexOf(agentGroup(a, origin)) - groups.indexOf(agentGroup(b, origin)) ||
    states.indexOf(a.activity.state) - states.indexOf(b.activity.state) ||
    clean(a.session.name ?? "").localeCompare(clean(b.session.name ?? "")) ||
    agentKey(a).localeCompare(agentKey(b)));
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const spinner = (now = Date.now()): string => SPINNER[Math.floor(now / 100) % SPINNER.length];

export const stateTone: Record<AgentSnapshot["activity"]["state"], BrowserTone> = { waiting: "warning", busy: "accent", idle: "success", unknown: "dim" };

export function stateGlyph(state: AgentSnapshot["activity"]["state"], now = Date.now()): string {
  if (state === "busy") return spinner(now);
  if (state === "waiting") return Math.floor(now / 600) % 2 ? "◇" : "◆";
  return state === "idle" ? "●" : "○";
}

/** Compact age such as `12s`, `4m`, `3h`, `2d`. */
export function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

const home = homedir();
export const shortPath = (path: string): string => clean(home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path);

export function agentName(agent: AgentSnapshot): string {
  const cwd = agent.session.cwd ?? agent.pane?.cwd;
  return clean(agent.session.name || cwd?.split("/").filter(Boolean).at(-1) || agent.session.id?.slice(0, 8) || agent.harness);
}

export const modelName = (agent: AgentSnapshot): string | undefined => agent.model ? clean(agent.model.displayName ?? agent.model.id) : undefined;

export const harnessText = (harness: AgentSnapshot["harness"], theme: BrowserTheme, text: string): string =>
  theme.harness ? theme.harness(harness, text) : theme.fg(harness === "pi" ? "syntaxKeyword" : "syntaxNumber", text);

export function harnessBadge(agent: AgentSnapshot, theme: BrowserTheme, pad = true): string {
  return agent.harness === "pi" ? harnessText("pi", theme, "π pi") + (pad ? "    " : "") : harnessText("claude", theme, "✻ claude");
}

function listenerStatus(agent: AgentSnapshot, registryState: RegistryView["state"]): "listening" | "off" | "stale" {
  if (!agent.messaging) return "off";
  const reportedAt = agent.messaging.reportedAt;
  const now = Date.now();
  return registryState === "stale" || registryState === "unavailable" || !recentAgent(agent) ||
    reportedAt > now + 5000 || now - reportedAt > 20_000 ? "stale" : "listening";
}

export function listenerBadge(agent: AgentSnapshot, theme: BrowserTheme, registryState: RegistryView["state"] = "fresh", glyphOnly = false): string {
  const listener = listenerStatus(agent, registryState);
  const [tone, glyph, label]: [BrowserTone, string, string] = listener === "listening" ? ["success", "◉", "listening"]
    : listener === "stale" ? ["warning", "◎", "listener stale"] : ["dim", "○", "listener off"];
  return theme.fg(tone, glyphOnly ? glyph : `${glyph} ${label}`);
}

/** `950`, `1.2K`, `48K`, `3.4M`, `120M`. */
export function compactCount(value: number): string {
  const unit = (n: number, suffix: string) => `${(n < 10 ? n.toFixed(1) : Math.round(n).toString()).replace(/\.0$/, "")}${suffix}`;
  if (value < 1000) return String(value);
  if (value < 999_500) return unit(value / 1000, "K");
  if (value < 999_500_000) return unit(value / 1e6, "M");
  return unit(value / 1e9, "B");
}

/** Context fill in 0–1, or undefined when the harness has not reported token usage. */
export const contextRatio = (agent: AgentSnapshot): number | undefined =>
  agent.context && agent.context.tokens !== null ? Math.min(1, agent.context.tokens / agent.context.window) : undefined;

export const contextTone = (ratio: number): BrowserTone => ratio >= 0.8 ? "error" : ratio >= 0.5 ? "warning" : "success";

/** Compact pie-and-percent indicator such as `◑ 52%`; empty when no window is known. */
export function contextBadge(agent: AgentSnapshot, theme: BrowserTheme): string {
  if (!agent.context) return "";
  const ratio = contextRatio(agent);
  if (ratio === undefined) return theme.fg("dim", "◌ –");
  const pie = ["○", "◔", "◑", "◕", "●"][ratio > 0 ? Math.max(1, Math.round(ratio * 4)) : 0];
  return theme.fg(contextTone(ratio), `${pie} ${Math.round(ratio * 100)}%`);
}

/** Wider gauge for headers: `ctx ▰▰▰▱▱▱▱▱ 38% 76K/200K`. */
export function contextGauge(agent: AgentSnapshot, theme: BrowserTheme, cells = 8): string {
  if (!agent.context) return "";
  const ratio = contextRatio(agent);
  const window = compactCount(agent.context.window);
  if (ratio === undefined) return `${theme.fg("dim", "ctx")} ${theme.fg("dim", "▱".repeat(cells))} ${theme.fg("dim", `–/${window}`)}`;
  const filled = Math.max(ratio > 0 ? 1 : 0, Math.min(cells, Math.round(ratio * cells)));
  const tone = contextTone(ratio);
  return `${theme.fg("dim", "ctx")} ${theme.fg(tone, "▰".repeat(filled))}${theme.fg("dim", "▱".repeat(cells - filled))} ` +
    `${theme.fg(tone, `${Math.round(ratio * 100)}%`)} ${theme.fg("dim", `${compactCount(agent.context.tokens!)}/${window}`)}`;
}

export interface RowOptions {
  width: number;
  now?: number;
  nameWidth?: number;
  /** Activity changed recently; drawn as a short-lived spark next to the state. */
  changed?: boolean;
}

export const agentDescription = (agent: AgentSnapshot, theme?: BrowserTheme): string => {
  const cwd = agent.session.cwd ?? agent.pane?.cwd;
  const model = modelName(agent);
  const parts = [
    model && (theme ? theme.fg("syntaxType", model) : model),
    cwd && (theme ? theme.fg("muted", shortPath(cwd)) : shortPath(cwd)),
    agent.activity.waitingFor && (theme ? theme.fg("warning", `⧗ ${clean(agent.activity.waitingFor)}`) : clean(agent.activity.waitingFor)),
  ].filter(Boolean);
  return parts.join(theme ? theme.fg("dim", " · ") : " · ");
};

export function agentRow(agent: AgentSnapshot, selected: boolean, theme: BrowserTheme, origin?: Origin, registryState: RegistryView["state"] = "fresh", options: RowOptions = { width: 120 }): string {
  const now = options.now ?? Date.now();
  const state = agent.activity.state;
  const tone = stateTone[state];
  const name = agentName(agent);
  const nameWidth = Math.max(4, Math.min(28, options.nameWidth ?? visibleWidth(name)));
  const marker = selected ? theme.fg("accent", theme.bold("→")) : " ";
  const nameText = truncateToWidth(name, nameWidth, "…");
  const tags = !recentAgent(agent) ? theme.fg("warning", "stale") : "";
  const compact = options.width < 72;
  const left = `${marker} ${theme.fg(tone, stateGlyph(state, now))} ` +
    (selected ? theme.bold(theme.fg("text", nameText)) : theme.fg("text", nameText)) + " ".repeat(Math.max(0, nameWidth - visibleWidth(nameText))) +
    (compact
      ? ` ${harnessText(agent.harness, theme, agent.harness === "pi" ? "π" : "✻")}${options.changed ? theme.fg("accent", "✦") : " "}`
      : `  ${harnessBadge(agent, theme)}  ${theme.fg(tone, state.padEnd(7))}${options.changed ? theme.fg("accent", "✦") : " "} `) +
    (tags ? `${tags} ` : "");
  const badge = listenerBadge(agent, theme, registryState, compact);
  const context = contextBadge(agent, theme);
  const right = ` ${" ".repeat(Math.max(0, 6 - visibleWidth(context)))}${context}  ${" ".repeat(Math.max(0, (compact ? 1 : 16) - visibleWidth(badge)))}${badge}  ${theme.fg("dim", `up ${ago(now - agent.process.startedAt).padStart(3)}`)}`;
  const description = agentDescription(agent, theme);
  const room = options.width - visibleWidth(left) - visibleWidth(right);
  let line: string;
  if (room >= 8) {
    const middle = truncateToWidth(description, room, "…");
    line = left + middle + " ".repeat(room - visibleWidth(middle)) + right;
  } else line = left + right + " " + description;
  if (!selected || !theme.bg) return line;
  const fitted = truncateToWidth(line, options.width);
  // Inner full/background resets (truncation emits \x1b[0m) would otherwise end the highlight mid-row.
  const [on, off] = theme.bg("selectedBg", "\0").split("\0");
  const padded = fitted + " ".repeat(Math.max(0, options.width - visibleWidth(fitted)));
  return on + padded.replace(/\x1b\[(0|49)?m/g, reset => reset + on) + off;
}

export function groupHeading(group: string, count: number, width: number, theme: BrowserTheme): string {
  const label = ` ${theme.fg("accent", theme.bold(group))} ${theme.fg("dim", String(count))} `;
  return theme.fg("borderMuted", "──") + label + theme.fg("borderMuted", "─".repeat(Math.max(0, width - visibleWidth(label) - 2)));
}

/** One-line identity used above previews and details. */
export function agentHeadline(agent: AgentSnapshot, theme: BrowserTheme, now = Date.now()): string {
  const state = agent.activity.state;
  const gauge = contextGauge(agent, theme);
  return `${theme.fg(stateTone[state], `${stateGlyph(state, now)} ${state}`)}  ${harnessBadge(agent, theme, false)}  ` +
    (gauge ? `${gauge}  ` : "") + `${agentDescription(agent, theme)}${theme.fg("dim", ` · up ${ago(now - agent.process.startedAt)}`)}`;
}

export function detailLines(agent: AgentSnapshot, width: number, theme: BrowserTheme, listed: boolean, registryState: RegistryView["state"] = "fresh"): string[] {
  const pane = agent.pane;
  const now = Date.now();
  const listener = listenerStatus(agent, listed ? registryState : "stale");
  const listenerDescription = listener === "listening" ? "advertised (not probed)" :
    listener === "stale" ? "stale advertisement (not probed)" : "off (not advertised)";
  const time = (at: number) => new Date(at).toISOString();
  const since = (at: number) => theme.fg("dim", ` (${ago(now - at)} ago)`);
  const sections: Array<[string, BrowserTone, Array<[string, string | undefined, BrowserTone?, string?, string?]>]> = [
    ["Process", "syntaxKeyword", [
      ["harness", agent.harness, undefined, undefined, harnessText(agent.harness, theme, clean(agent.harness))], ["PID", String(agent.process.pid), "syntaxNumber"],
      ["started", time(agent.process.startedAt), undefined, since(agent.process.startedAt)],
      ["observed", time(agent.observedAt), undefined, since(agent.observedAt)], ["mode", agent.session.mode],
      ["listener", listenerDescription, listener === "listening" ? "success" : listener === "stale" ? "warning" : "dim"],
    ]],
    ["Activity", stateTone[agent.activity.state], [
      ["activity", agent.activity.state, stateTone[agent.activity.state]], ["activity source", agent.activity.source],
      ["raw state", agent.activity.rawState], ["waiting for", agent.activity.waitingFor, "warning"],
    ]],
    ["Session", "mdHeading", [
      ["session", agent.session.id, "mdCode"], ["name", agent.session.name], ["session file", agent.session.file, "mdLink"],
      ["cwd", agent.session.cwd ?? pane?.cwd, "mdLink"],
    ]],
    ["Model", "syntaxType", [["model", agent.model?.id, "syntaxType"], ["model provider", agent.model?.provider], ["model name", agent.model?.displayName],
      ["context", agent.context ? `${agent.context.tokens === null ? "unknown" : compactCount(agent.context.tokens)} / ${compactCount(agent.context.window)} tokens` : undefined,
        contextRatio(agent) === undefined ? "dim" : contextTone(contextRatio(agent)!),
        agent.context ? `${contextRatio(agent) === undefined ? "" : ` (${Math.round(contextRatio(agent)! * 100)}%)`}${theme.fg("dim", ` via ${agent.context.source}`)}` : undefined]]],
    ["Tmux", "syntaxFunction", [
      ["tmux server", pane?.server], ["pane", pane ? `${pane.sessionName}:${pane.windowIndex}.${pane.paneIndex} ${pane.id}` : undefined, "syntaxFunction"],
    ]],
  ];
  const keyWidth = 15;
  const lines = [theme.fg("accent", theme.bold("Metadata")), ...(listed ? [] : [theme.fg("warning", "▲ This process is no longer listed.")])];
  for (const [title, tone, fields] of sections) {
    const present = fields.filter(([, value]) => value !== undefined);
    if (!present.length) continue;
    lines.push("", `${theme.fg(tone, "▍")}${theme.bold(theme.fg(tone, title))}`);
    for (const [key, value, valueTone, suffix = "", styled] of present) {
      const text = styled ?? clean(value!);
      const label = theme.fg("dim", `${key}:`.padStart(keyWidth + 1));
      const room = width - keyWidth - 2;
      if (room < 12) { lines.push(...wrapTextWithAnsi(`${label} ${valueTone ? theme.fg(valueTone, text) : text}${suffix}`, Math.max(1, width))); continue; }
      // Hanging indent keeps long paths aligned under their value column.
      const wrapped = wrapTextWithAnsi(`${valueTone ? theme.fg(valueTone, text) : text}${suffix}`, room);
      lines.push(...wrapped.map((line, i) => `${i ? " ".repeat(keyWidth + 1) : label} ${line}`));
    }
  }
  return lines;
}

export interface FrameOptions {
  title?: string;
  status?: string;
  tone?: BrowserTone;
  /** Draws a thumb on the right border for a scrolled region of `size` rows starting at line `start`. */
  scroll?: { start: number; size: number; offset: number; total: number };
}

export function frame(lines: string[], width: number, height: number, theme: Pick<BrowserTheme, "fg">, options: FrameOptions = {}): string[] {
  if (width < 3 || height < 3) return lines.slice(0, Math.max(1, height)).map(line => truncateToWidth(line, width));
  const inner = width - 2;
  const tone = options.tone ?? "border";
  const border = (text: string) => theme.fg(tone, text);
  const body = lines.slice(0, height - 2);
  while (body.length < height - 2) body.push("");
  let thumb = [-1, -1];
  const scroll = options.scroll;
  if (scroll && scroll.total > scroll.size && scroll.size > 0) {
    const size = Math.max(1, Math.round(scroll.size * scroll.size / scroll.total));
    const at = Math.round(scroll.offset / (scroll.total - scroll.size) * (scroll.size - size));
    thumb = [scroll.start + at, scroll.start + at + size];
  }
  const row = (line: string, index: number) => {
    const text = truncateToWidth(line, inner);
    const right = index >= thumb[0] && index < thumb[1] ? theme.fg("accent", "┃") : border("│");
    return border("│") + text + " ".repeat(Math.max(0, inner - visibleWidth(text))) + right;
  };
  let top = border(`╭${"─".repeat(inner)}╮`);
  if (options.title && inner >= 6) {
    const status = options.status && visibleWidth(options.title) + visibleWidth(options.status) + 8 <= inner ? ` ${options.status} ` : "";
    const title = ` ${truncateToWidth(options.title, Math.max(1, inner - 4 - visibleWidth(status)), "…")} `;
    const fill = Math.max(0, inner - 1 - visibleWidth(title) - visibleWidth(status) - (status ? 1 : 0));
    top = border("╭─") + title + border("─".repeat(fill)) + status + border(status ? "─╮" : "╮");
  }
  return [top, ...body.map(row), border(`╰${"─".repeat(inner)}╯`)];
}
