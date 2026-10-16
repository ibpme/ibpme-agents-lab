import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createBrowser } from "@agent-hub/viewer/browser";
import type { RegistryView } from "@agent-hub/viewer/reader";
import { openBrowser, viewerTheme } from "./native.ts";

const theme = { fg: (_tone: string, text: string) => text, bold: (text: string) => text };
const fresh = (): RegistryView => ({ state: "fresh", agents: [], warnings: [] });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("modal uses the injected terminal for resize and closes without waiting for registry", async () => {
  const terminal = { columns: 120, rows: 40 };
  let resolveRead!: (view: RegistryView) => void;
  let reads = 0;
  let component!: ReturnType<typeof createBrowser>;
  const ctx = { ui: { custom: (factory: any, options: any) => new Promise<void>(resolve => {
    component = factory({ terminal, requestRender() {} }, theme, {}, resolve);
    assert.equal(options.overlayOptions().width, 118);
    terminal.columns = 60;
    assert.equal(options.overlayOptions().width, 58);
    component.handleInput("q");
  }) } } as unknown as ExtensionCommandContext;
  await openBrowser(ctx, { readRegistry: () => { reads++; return new Promise(r => { resolveRead = r; }); }, performPaneAction: async () => {} });
  resolveRead(fresh());
  await tick();
  assert.equal(reads, 1);
  assert.ok(!component.render(80).join("\n").includes("main"));
});

test("viewer theme keeps Pi theme methods and adds harness colors at Pi's color depth", () => {
  class FakeTheme {
    private prefix = "p:";
    fg(_tone: string, text: string) { return this.prefix + text; }
    bold(text: string) { return text; }
    getColorMode() { return "truecolor" as const; }
  }
  const wrapped = viewerTheme(new FakeTheme());
  assert.equal(wrapped.fg("accent", "x"), "p:x");
  assert.equal(wrapped.harness!("pi", "π"), "\x1b[38;2;167;139;250mπ\x1b[39m");
  assert.equal(viewerTheme(theme).harness!("claude", "✻"), "\x1b[33m✻\x1b[39m");
});
