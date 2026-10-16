import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ansiTheme } from "./terminal.ts";
import { agentRow, frame, groupHeading } from "./view.ts";
import type { AgentSnapshot } from "./reader.ts";

test("rich terminals use Pi dark colors at their advertised color depth", () => {
  const full = ansiTheme({ COLORTERM: "truecolor" });
  assert.equal(full.fg("accent", "text"), "\x1b[38;2;167;152;215mtext\x1b[39m");
  assert.equal(full.fg("success", "idle"), "\x1b[38;2;104;183;141midle\x1b[39m");
  assert.equal(full.fg("border", "│"), "\x1b[38;2;95;168;204m│\x1b[39m");
  assert.equal(full.fg("text", "body"), "\x1b[38;2;222;224;225mbody\x1b[39m");
  assert.equal(full.bg!("selectedBg", "row"), "\x1b[48;2;33;59;73mrow\x1b[49m");
  const indexed = ansiTheme({ TERM: "screen-256color" });
  assert.equal(indexed.fg("accent", "text"), "\x1b[38;5;140mtext\x1b[39m");
  assert.equal(indexed.bg!("selectedBg", "row"), "\x1b[48;5;23mrow\x1b[49m");
  assert.notEqual(full.fg("warning", "!"), full.fg("error", "!"));
});

test("basic terminals avoid bright ANSI variants and unsupported backgrounds", () => {
  const theme = ansiTheme({ TERM: "vt100" });
  for (const tone of ["accent", "success", "warning", "error", "mdHeading", "toolTitle"] as const) {
    assert.ok(!/\x1b\[9[1-7]m/.test(theme.fg(tone, "text")));
    assert.ok(!theme.fg(tone, "text").includes(";5;"));
  }
  assert.equal(theme.bg, undefined);
});

test("NO_COLOR disables every style even when truecolor is available", () => {
  const theme = ansiTheme({ NO_COLOR: "", COLORTERM: "truecolor", TERM: "xterm-256color" });
  for (const style of [theme.bold, theme.italic!, theme.underline!, (s: string) => theme.fg("accent", s), (s: string) => theme.harness!("pi", s)]) {
    assert.equal(style("text"), "text");
  }
  assert.equal(theme.bg, undefined);
});

test("styled rows and frames retain their geometry and selection", () => {
  const theme = ansiTheme({ COLORTERM: "truecolor" });
  const now = Date.now();
  const agent: AgentSnapshot = { schemaVersion: 1, harness: "pi", observedAt: now,
    process: { pid: 1, startedAt: now }, session: { mode: "interactive", name: "design", cwd: "/work" },
    activity: { state: "idle", source: "pi-registry" } };
  for (const width of [40, 80, 140]) {
    const row = agentRow(agent, true, theme, undefined, "fresh", { width: width - 2 });
    assert.ok(row.includes("→"));
    assert.ok(row.includes("\x1b[48;2;33;59;73m"));
    const lines = frame([groupHeading("Current session", 1, width - 2, theme), row], width, 8, theme);
    assert.ok(lines.every(line => visibleWidth(line) === width));
  }
});
