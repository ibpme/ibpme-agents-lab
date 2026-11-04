import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { FAST_STATUS_KEY } from "../contracts/status-keys.ts";
import extension from "./index.ts";

test("fast badge follows the thinking level, appears once, and disappears when cleared", () => {
  let start!: (event: unknown, ctx: ExtensionContext) => unknown;
  let footer!: { render(width: number): string[]; dispose(): void };
  const statuses = new Map([[FAST_STATUS_KEY, "fast"]]);
  const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme;
  extension({
    events: { on: () => () => {} },
    on: (name: string, handler: typeof start) => { if (name === "session_start") start = handler; },
    registerCommand: () => {}, getThinkingLevel: () => "high",
    getAllTools: () => [], getActiveTools: () => [], getCommands: () => [],
  } as unknown as ExtensionAPI);
  const ctx = {
    model: { ...openaiProvider().getModels()[0], reasoning: true },
    modelRegistry: { isUsingOAuth: () => true },
    getContextUsage: () => undefined,
    sessionManager: { getBranch: () => [], getCwd: () => "/project", getSessionName: () => undefined },
    ui: { setFooter: (factory: Function) => {
      footer = factory({ requestRender: () => {} }, theme, {
        getGitBranch: () => undefined, getExtensionStatuses: () => statuses, onBranchChange: () => () => {},
      });
    } },
  } as unknown as ExtensionContext;
  start({}, ctx);
  try {
    const lines = footer.render(200);
    assert.match(lines[1], /openai\/.* • high • fast$/);
    assert.equal(lines.join("\n").split("fast").length - 1, 1);
    statuses.clear();
    assert.doesNotMatch(footer.render(200).join("\n"), /fast/);
    statuses.set(FAST_STATUS_KEY, "fast");
    ctx.model = { ...ctx.model!, reasoning: false };
    assert.match(footer.render(200)[1], / • fast$/);
  } finally {
    footer.dispose();
  }
});
