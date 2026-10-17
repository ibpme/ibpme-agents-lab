import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { extensionTestHost } from "../shared/extension-test-host.ts";
import type { ToolSet } from "./contracts.ts";
import { registerViewer } from "./viewer.ts";

test("compact viewer expands only the selected tool with right/left arrows", async () => {
  const h = extensionTestHost();
  h.tools.set("example", {
    name: "example", label: "Example", description: "Example description. Extended instructions only in details.",
    parameters: { type: "object", properties: { path: { type: "string", description: "File path" } }, required: ["path"] },
    promptGuidelines: ["Registered guideline"],
    execute: async () => ({ content: [], details: undefined }),
  });
  h.tools.set("second", {
    name: "second", label: "Second", description: "Second description.",
    parameters: { type: "object", properties: {} },
    promptGuidelines: ["Second guideline"],
    execute: async () => ({ content: [], details: undefined }),
  });
  registerViewer(h.pi, {
    getMode: () => "yolo", isBlockedInSafe: () => false,
  } as unknown as ToolSet);
  let redraws = 0;
  const ctx = {
    ...h.ctx,
    getSystemPromptOptions: () => ({
      toolSnippets: { example: "Example prompt snippet" },
      toolGuidelines: { example: ["Current prompt guideline"] },
    }),
    ui: {
      ...h.ctx.ui,
      custom: async (factory: any) => {
        const terminal = { rows: 100 };
        const component = factory({
          terminal, requestRender: () => { redraws++; },
        }, h.ctx.ui.theme, {}, () => {});
        const collapsed = component.render(100).join("\n");
        assert.match(collapsed, /▸ example/);
        assert.match(collapsed, /▸ second/);
        assert.doesNotMatch(collapsed, /Example description|Second description|path: string|Arguments/);
        assert.doesNotMatch(collapsed, /Extended instructions|"properties"|"type"|[{}]/);
        assert.doesNotMatch(collapsed, /Example prompt snippet|Current prompt guideline|Metadata:/);
        component.handleInput("\x1b[C");
        component.handleInput("\x1b[C");
        const expanded = component.render(100).join("\n");
        assert.match(expanded, /Example prompt snippet/);
        assert.match(expanded, /Current prompt guideline/);
        assert.doesNotMatch(expanded, /Registered guideline/);
        assert.match(expanded, /Extended instructions/);
        assert.match(expanded, /path: string \(required\) — File path/);
        assert.doesNotMatch(expanded, /Second guideline|"properties"|[{}]/);
        assert.ok(expanded.indexOf("Arguments") < expanded.indexOf("Prompt snippet"));
        for (const width of [5, 20, 60]) {
          assert.ok(component.render(width).every((line: string) => visibleWidth(line) <= width));
        }
        component.invalidate();
        component.handleInput("\x1b[D");
        assert.doesNotMatch(component.render(100).join("\n"), /Example prompt snippet|Example description|path: string/);
        component.handleInput("\x1b[B");
        component.handleInput("\x1b[C");
        const second = component.render(100).join("\n");
        assert.match(second, /Second guideline/);
        assert.doesNotMatch(second, /Example prompt snippet/);
        component.handleInput("\r");
        assert.doesNotMatch(component.render(100).join("\n"), /Second guideline/);
        terminal.rows = 15;
        component.handleInput("\x1b[H");
        component.handleInput("\x1b[C");
        component.render(60);
        component.handleInput("\x1b[6~");
        const scrolled = component.render(60).join("\n");
        assert.match(scrolled, /Prompt snippet|Example prompt snippet|Prompt guidelines/);
        component.handleInput("\x1b[D");
        assert.match(component.render(60).join("\n"), /▸ example/);
        assert.doesNotMatch(component.render(60).join("\n"), /Example description|path: string/);
        terminal.rows = 2;
        assert.ok(component.render(20).length <= 2);
        component.handleInput("q");
      },
    },
  } as unknown as ExtensionCommandContext;
  await h.commands.get("tools")!.handler("", ctx);
  assert.ok(redraws >= 3);
  assert.equal(h.loadoutWrites(), 0);
});
