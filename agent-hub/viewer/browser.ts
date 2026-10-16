import type { BrowserTheme } from "./theme.ts";
import { Key, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { AgentSnapshot, RegistryView } from "./reader.ts";
import { createSessionReader, type SessionSnapshot, type SessionReaderOptions } from "./session.ts";
import { activityLine, metricsLines, transcriptLines } from "./transcript.ts";
import type { Origin, PaneAction, performPaneAction } from "./tmux-actions.ts";
import {
  agentDescription, agentGroup, agentHeadline, agentKey, agentName, agentRow, ago, clean, detailLines, frame,
  groupHeading, modelName, paneActionReason, sortAgents, spinner, stateGlyph, stateTone,
} from "./view.ts";

export interface BrowserDependencies {
  readRegistry(): Promise<RegistryView>;
  readSession?(agent: AgentSnapshot): Promise<SessionSnapshot>;
  currentPi?: SessionReaderOptions["currentPi"];
  origin?: Origin;
  performPaneAction: typeof performPaneAction;
}

interface SessionPreview {
  read: (agent: AgentSnapshot) => Promise<SessionSnapshot>;
  agent: AgentSnapshot;
  snapshot?: SessionSnapshot;
  loading: boolean;
  reading: boolean;
  follow: boolean;
  scroll: number;
  length: number;
  error: string;
  /** Entry count when following stopped; later entries are announced as new. */
  seen: number;
  /** Wrapped transcript reused across animation frames until the snapshot or width changes. */
  cache?: { snapshot?: SessionSnapshot; width: number; lines: string[] };
}

const CHANGE_SPARK_MS = 5000;
const NOTICE_MS = 5000;
const ACTION_DONE: Record<PaneAction, string> = { attach: "Attached", vertical: "Moved pane below this one", horizontal: "Moved pane beside this one", kill: "Killed pane" };

const keyHints = (theme: BrowserTheme, hints: Array<[string, string] | false | undefined>): string =>
  hints.filter((hint): hint is [string, string] => !!hint)
    .map(([key, label]) => `${theme.fg("accent", theme.bold(key))} ${theme.fg("muted", label)}`).join(theme.fg("dim", " · "));

export function createBrowser(
  deps: BrowserDependencies, terminal: { columns: number; rows: number }, theme: BrowserTheme,
  requestRender: () => void, done: () => void,
) {
  let view: RegistryView = { state: "unavailable", agents: [], warnings: [] };
  let loading = true;
  let reading = false;
  let closed = false;
  let busy = false;
  let selected = 0;
  let offset = 0;
  let detail: AgentSnapshot | undefined;
  let scroll = 0;
  let pendingKill: AgentSnapshot | undefined;
  let error = "";
  let notice: { text: string; at: number } | undefined;
  let page = 8;
  let detailLength = 0;
  let preview: SessionPreview | undefined;
  let filter = "";
  let filtering = false;
  const changes = new Map<string, { state: string; at: number }>();
  const matches = (agent: AgentSnapshot) => !filter || [agentName(agent), agent.harness, agent.activity.state, agentDescription(agent), modelName(agent), agentGroup(agent, deps.origin)]
    .some(value => value?.toLowerCase().includes(filter.toLowerCase()));
  const listed = () => view.agents.filter(matches);
  const animating = () => busy || loading || (preview ? [preview.agent] : detail ? [detail] : view.agents)
    .some(agent => agent.activity.state === "busy" || agent.activity.state === "waiting");
  // Spinners and pulses are time-derived; this only asks for frames while something is moving.
  let ticker: ReturnType<typeof setInterval> | undefined = setInterval(() => { if (animating()) render(); }, 100);
  ticker.unref?.();
  const stop = () => { if (ticker) { clearInterval(ticker); ticker = undefined; } };
  const refreshPreview = async () => {
    const current = preview;
    if (closed || !current || current.reading) return;
    current.reading = true;
    try {
      const snapshot = await current.read(current.agent);
      if (!closed && preview === current) {
        current.snapshot = snapshot; current.error = "";
        if (current.follow) current.seen = snapshot.entries.length;
      }
    } catch (err) {
      if (!closed && preview === current) current.error = clean(err instanceof Error ? err.message : String(err));
    } finally {
      current.reading = false;
      current.loading = false;
      if (preview === current) render();
    }
  };
  const render = () => { if (!closed) requestRender(); };
  const finish = () => { if (!closed) { closed = true; stop(); done(); } };
  const apply = (next: RegistryView) => {
    const key = listed()[selected] ? agentKey(listed()[selected]) : undefined;
    const now = Date.now();
    for (const agent of next.agents) {
      const previous = changes.get(agentKey(agent));
      if (!previous || previous.state !== agent.activity.state) changes.set(agentKey(agent), { state: agent.activity.state, at: previous ? now : 0 });
    }
    const present = new Set(next.agents.map(agentKey));
    for (const key of changes.keys()) if (!present.has(key)) changes.delete(key);
    view = { ...next, agents: sortAgents(next.agents, deps.origin) };
    const index = listed().findIndex(agent => agentKey(agent) === key);
    selected = index >= 0 ? index : 0;
    if (detail) detail = next.agents.find(agent => agentKey(agent) === agentKey(detail!)) ?? detail;
    if (preview) preview.agent = next.agents.find(agent => agentKey(agent) === agentKey(preview!.agent)) ?? preview.agent;
  };
  const refresh = async () => {
    if (closed || reading || busy || pendingKill) return;
    reading = true;
    try {
      const next = await deps.readRegistry();
      if (!closed) apply(next);
    } catch (err) {
      if (!closed) view = { state: "unavailable", agents: view.agents, warnings: [clean(String(err))] };
    } finally { reading = false; loading = false; render(); }
    await refreshPreview();
  };
  const action = async (agent: AgentSnapshot, kind: PaneAction) => {
    const reason = paneActionReason(view, agent, deps.origin, kind);
    if (reason) { error = reason; render(); return; }
    busy = true;
    error = "";
    notice = undefined;
    render();
    try {
      // The writer may have stopped since the modal's last refresh. Reopen health before every action.
      const next = await deps.readRegistry();
      if (closed) return;
      apply(next);
      const current = next.agents.find(item => agentKey(item) === agentKey(agent));
      const invalid = current ? paneActionReason(next, current, deps.origin, kind) : "Agent is no longer listed.";
      if (invalid) throw new Error(invalid);
      if (current!.pane?.id !== agent.pane?.id || current!.pane?.server !== agent.pane?.server) throw new Error("Agent pane changed; refresh before acting.");
      await deps.performPaneAction(deps.origin!, current!, kind);
      notice = { text: `${ACTION_DONE[kind]} · ${agentName(current!)}`, at: Date.now() };
    } catch (err) { if (!closed) error = clean(err instanceof Error ? err.message : String(err)); }
    finally { busy = false; if (!closed) { await refresh(); render(); } }
  };

  const healthChip = () => {
    if (loading) return theme.fg("accent", `${spinner()} loading`);
    // Daemon write time, not local poll time, so a stalled writer visibly ages.
    const age = view.updatedAt === undefined ? "" : theme.fg("dim", ` ${ago(Math.max(0, Date.now() - view.updatedAt))}`);
    return view.state === "fresh" ? theme.fg("success", "● live") + age
      : view.state === "degraded" ? theme.fg("warning", "◐ degraded") + age
        : view.state === "stale" ? theme.fg("warning", "◌ stale") + age : theme.fg("error", "✗ offline");
  };
  const summary = (agents: AgentSnapshot[], width: number) => {
    const states = (["waiting", "busy", "idle", "unknown"] as const).map(state => [state, agents.filter(agent => agent.activity.state === state).length] as const);
    const chips = states.filter(([, count]) => count).map(([state, count]) =>
      theme.fg(stateTone[state], `${stateGlyph(state)} ${theme.bold(String(count))} ${state}`)).join("   ");
    const total = filter || filtering
      ? `${theme.fg("accent", "/")}${theme.fg("text", filter)}${filtering ? theme.fg("accent", "▏") : ""} ${theme.fg("dim", `${agents.length}/${view.agents.length}`)}`
      : theme.fg("muted", `${view.agents.length} sessions`);
    const left = chips || theme.fg("dim", loading ? "Loading registry…" : "No agents yet");
    const gap = width - visibleWidth(left) - visibleWidth(total);
    return gap >= 2 ? left + " ".repeat(gap) + total : `${left}  ${total}`;
  };

  return {
    refresh,
    render(width: number): string[] {
      const now = Date.now();
      const height = Math.max(1, terminal.rows - 2);
      const inner = Math.max(1, width - 4);
      const usageLines = preview ? metricsLines(preview.snapshot, inner, theme).slice(0, Math.max(1, Math.min(4, height - 7))) : [];
      if (usageLines.length && height >= 12) usageLines.push("");
      page = Math.max(1, height - 5 - usageLines.length);
      if (notice && now - notice.at > NOTICE_MS) notice = undefined;
      const warningText = error || preview?.error || [view.warnings.join(" · "), preview?.snapshot?.warnings.join(" · ")].filter(Boolean).join(" · ");
      const status = error || preview?.error ? theme.fg("error", `✗ ${clean(warningText)}`)
        : notice && !warningText ? theme.fg("success", `✓ ${clean(notice.text)}`)
          : warningText ? theme.fg("warning", `▲ ${clean(warningText)}`) : "";
      const agents = listed();
      let body: string[];
      let headline: string;
      let scrollInfo: { offset: number; total: number } | undefined;
      if (preview) {
        const entries = preview.snapshot?.entries ?? [];
        if (preview.cache?.snapshot !== preview.snapshot || preview.cache?.width !== inner) {
          preview.cache = { snapshot: preview.snapshot, width: inner, lines: transcriptLines(entries, inner, theme) };
        }
        const lines = [...preview.cache.lines];
        const trailer = activityLine(preview.agent, theme, now);
        if (trailer) lines.push(...(lines.length ? [""] : []), trailer);
        if (!lines.length) lines.push(theme.fg("dim", preview.loading ? `${spinner(now)} Loading session…` : preview.error ? "Session preview unavailable." : "No visible session messages yet."));
        preview.length = lines.length;
        const bottom = Math.max(0, lines.length - page);
        preview.scroll = preview.follow ? bottom : Math.max(0, Math.min(preview.scroll, bottom));
        body = lines.slice(preview.scroll, preview.scroll + page);
        headline = agentHeadline(preview.agent, theme, now);
        scrollInfo = { offset: preview.scroll, total: lines.length };
      } else if (detail) {
        const isListed = view.agents.some(agent => agentKey(agent) === agentKey(detail!));
        const lines = detailLines(detail, inner, theme, isListed, view.state);
        detailLength = lines.length;
        scroll = Math.max(0, Math.min(scroll, Math.max(0, lines.length - page)));
        body = lines.slice(scroll, scroll + page);
        headline = agentHeadline(detail, theme, now);
        scrollInfo = { offset: scroll, total: lines.length };
      } else {
        const rows: Array<{ index?: number; text: string }> = [];
        const nameWidth = Math.max(0, ...agents.map(agent => visibleWidth(agentName(agent))));
        let group = "";
        agents.forEach((agent, index) => {
          const nextGroup = agentGroup(agent, deps.origin);
          if (nextGroup !== group) {
            group = nextGroup;
            if (rows.length) rows.push({ text: "" });
            rows.push({ text: ` ${groupHeading(group, agents.filter(item => agentGroup(item, deps.origin) === group).length, inner, theme)}` });
          }
          const change = changes.get(agentKey(agent));
          rows.push({ index, text: agentRow(agent, index === selected, theme, deps.origin, view.state,
            { width: width - 3, now, nameWidth, changed: !!change?.at && now - change.at < CHANGE_SPARK_MS }) });
        });
        const selectedRow = Math.max(0, rows.findIndex(row => row.index === selected));
        offset = Math.max(0, Math.min(offset, selectedRow, Math.max(0, rows.length - page)));
        if (selectedRow >= offset + page) offset = selectedRow - page + 1;
        body = rows.slice(offset, offset + page).map(row => row.text);
        if (!body.length) body = [` ${theme.fg("dim", loading ? `${spinner(now)} Loading registry…` : view.state === "unavailable" ? "Start agents-registry to browse live agents."
          : filter ? `No agents match “${clean(filter)}”.` : "No agents recorded.")}`];
        headline = summary(agents, inner);
        scrollInfo = { offset, total: rows.length };
      }
      while (body.length < page) body.push("");
      const target = preview?.agent ?? detail ?? agents[selected];
      const eligible = target && !paneActionReason(view, target, deps.origin, "attach");
      const movable = target && !paneActionReason(view, target, deps.origin, "horizontal");
      const paneHints: Array<[string, string]> = movable ? [["V/H", "split"], ["Ctrl+X", "kill"]] : [];
      const unseen = preview && !preview.follow ? (preview.snapshot?.entries.length ?? 0) - preview.seen : 0;
      const footer = pendingKill ? theme.fg("warning", theme.bold(`▲ Kill entire pane ${pendingKill.pane?.id} for PID ${pendingKill.process.pid} (${clean(pendingKill.session.name ?? pendingKill.harness)})? [y/n]`))
        : busy ? theme.fg("accent", `${spinner(now)} Checking and acting…`)
          : filtering ? keyHints(theme, [["type", "to filter"], ["Enter", "keep"], ["Esc", "clear"]])
            : preview ? `${preview.follow ? theme.fg("success", "● Following") : theme.fg("warning", "‖ Paused")}` +
              (unseen > 0 ? theme.fg("warning", theme.bold(` ↓ ${unseen} new`)) : "") + theme.fg("dim", " · ") +
              keyHints(theme, [["↑↓", "scroll"], ["End", "follow"], ["←/Esc", "back"], ["r", "refresh"]])
              : detail ? keyHints(theme, [["↑↓", "scroll"], ["→", "session"], ["Esc", "back"], ["r", "refresh"], ...paneHints])
                : keyHints(theme, [["↑↓", "navigate"], ["→", "session"], ["Enter", eligible ? "attach" : "details"], ["i", "details"], ...paneHints,
                  ["/", "filter"], ["r", "refresh"], ["q", filter ? "clear" : "close"]]);
      const title = preview ? `${theme.fg("accent", "◀ ")}${theme.fg("accent", theme.bold(`Session · ${clean(preview.agent.session.name ?? preview.agent.session.id ?? preview.agent.harness)}`))}`
        : detail ? `${theme.fg("accent", "◀ ")}${theme.fg("accent", theme.bold(`Details · ${agentName(detail)}`))}`
          : `${theme.fg("accent", "◆")} ${theme.fg("accent", theme.bold("Agents"))}`;
      const lines = height < 7
        ? pendingKill ? [` ${footer}`] : [status ? ` ${status}` : body[0], ` ${footer}`]
        : [` ${headline}`, status ? ` ${status}` : "", ...usageLines.map(line => ` ${line}`), ...body.map(line => preview || detail ? ` ${line}` : line), ` ${footer}`];
      const start = 2 + usageLines.length;
      return frame(lines, width, height, theme, {
        title, status: healthChip(), tone: preview || detail ? "borderAccent" : "border",
        scroll: height < 7 || !scrollInfo ? undefined : { start, size: page, ...scrollInfo },
      });
    },
    handleInput(data: string): void {
      if (closed) return;
      if (filtering) {
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) { filtering = false; filter = ""; }
        else if (matchesKey(data, Key.enter)) filtering = false;
        else if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") filter = filter.slice(0, -1);
        else if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) selected = Math.max(0, Math.min(listed().length - 1, selected + (matchesKey(data, Key.up) ? -1 : 1)));
        else if (!/[\x00-\x1f\x7f]/.test(data)) filter += data;
        selected = Math.max(0, Math.min(selected, listed().length - 1));
        render(); return;
      }
      const back = matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || data === "q" || (!!preview && matchesKey(data, Key.left));
      if (back) {
        if (pendingKill) pendingKill = undefined;
        else if (preview) preview = undefined;
        else if (detail) { detail = undefined; scroll = 0; }
        else if (filter && !matchesKey(data, Key.ctrl("c"))) { filter = ""; selected = 0; }
        else finish();
        render(); return;
      }
      if (busy) return;
      if (pendingKill) {
        const target = pendingKill;
        if (data === "y" || data === "Y") { pendingKill = undefined; void action(target, "kill"); }
        else if (data === "n" || data === "N") pendingKill = undefined;
        render(); return;
      }
      error = "";
      notice = undefined;
      const target = detail ?? listed()[selected];
      if (data === "r") { void refresh(); return; }
      if (preview) {
        const delta = data === "k" || matchesKey(data, Key.up) ? -1 : data === "j" || matchesKey(data, Key.down) ? 1 : matchesKey(data, Key.pageUp) ? -page : matchesKey(data, Key.pageDown) ? page : 0;
        const bottom = Math.max(0, preview.length - page);
        if (matchesKey(data, Key.end)) { preview.follow = true; preview.scroll = bottom; }
        else if (matchesKey(data, Key.home) || delta) {
          preview.scroll = matchesKey(data, Key.home) ? 0 : Math.max(0, Math.min(bottom, preview.scroll + delta));
          preview.follow = !matchesKey(data, Key.home) && preview.scroll === bottom;
        }
        render(); return;
      }
      if (!detail && data === "/") { filtering = true; render(); return; }
      if (target && matchesKey(data, Key.right)) {
        preview = { read: deps.readSession ?? createSessionReader({ currentPi: deps.currentPi }), agent: target, loading: true, reading: false, follow: true, scroll: 0, length: 0, error: "", seen: 0 };
        void refreshPreview(); render(); return;
      }
      if (target && (data === "i" || matchesKey(data, Key.enter))) {
        if (!detail && data !== "i" && !paneActionReason(view, target, deps.origin, "attach")) void action(target, "attach");
        else { detail = target; scroll = 0; }
      } else if (target && (data === "V" || data === "H" || matchesKey(data, Key.shift("enter")))) {
        void action(target, data === "V" ? "vertical" : "horizontal");
      } else if (target && matchesKey(data, Key.ctrl("x"))) {
        const reason = paneActionReason(view, target, deps.origin, "kill");
        if (reason) error = reason; else pendingKill = target;
      } else {
        const up = data === "k" || matchesKey(data, Key.up);
        const down = data === "j" || matchesKey(data, Key.down);
        const delta = up ? -1 : down ? 1 : matchesKey(data, Key.pageUp) ? -page : matchesKey(data, Key.pageDown) ? page : 0;
        if (detail) {
          scroll = matchesKey(data, Key.home) ? 0 : matchesKey(data, Key.end) ? Math.max(0, detailLength - page) : Math.max(0, scroll + delta);
        } else {
          const count = listed().length;
          selected = matchesKey(data, Key.home) ? 0 : matchesKey(data, Key.end) ? Math.max(0, count - 1)
            : matchesKey(data, Key.tab) ? nextGroup(1) : matchesKey(data, Key.shift("tab")) ? nextGroup(-1)
              : Math.max(0, Math.min(count - 1, selected + delta));
        }
      }
      render();
    },
    invalidate() {},
    dispose() { closed = true; stop(); },
  };

  /** Index of the first agent in the next (or previous) group, wrapping around. */
  function nextGroup(direction: 1 | -1): number {
    const agents = listed();
    if (!agents.length) return 0;
    const starts = agents.flatMap((agent, index) => !index || agentGroup(agents[index - 1], deps.origin) !== agentGroup(agent, deps.origin) ? [index] : []);
    const current = starts.filter(start => start <= selected).length - 1;
    return starts[(current + direction + starts.length) % starts.length];
  }
}
