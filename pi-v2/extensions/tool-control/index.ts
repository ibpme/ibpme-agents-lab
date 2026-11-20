import { StringEnum } from "@earendil-works/pi-ai";
import {
  createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition,
  type ExtensionAPI, type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { blockedInSafe, MODE_ENTRY, restoreMode, type Mode } from "./policy.ts";
import { registerModeNotice } from "./state-notice.ts";
import { registerViewer, updateToolStatuses } from "./viewer.ts";

const changeMode = "change_mode";
const entryPoints = ["codemode", "tool_search", changeMode];
const commands = [
  { name: "safe", mode: "safe", description: "Enable SAFE execution policy" },
  { name: "yolo", mode: "yolo", description: "Lift SAFE execution restrictions" },
  { name: "auto", mode: "yolo", description: "Alias for /yolo" },
] as const;

function approvalResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], details: undefined, isError };
}

export default function toolControl(pi: ExtensionAPI): void {
  let mode: Mode = "yolo";
  let revision = 0;
  let footerRefresh: ReturnType<typeof setInterval> | undefined;
  const toolStatuses = new Map<string, string>();

  function updateStatus(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;
    const { theme } = ctx.ui;
    ctx.ui.setStatus("mode", mode === "safe"
      ? theme.fg("success", theme.bold("● SAFE"))
      : theme.fg("error", theme.bold("⏵⏵ YOLO")));
    updateToolStatuses(pi, ctx, toolStatuses);
  }

  function setMode(next: Mode, ctx: ExtensionContext) {
    if (next !== mode) {
      pi.appendEntry(MODE_ENTRY, { mode: next });
      mode = next;
    }
    revision++;
    updateStatus(ctx);
  }

  for (const { name, mode, description } of commands) {
    pi.registerCommand(name, { description, handler: async (_args, ctx) => setMode(mode, ctx) });
  }
  pi.registerShortcut("shift+tab", {
    description: "Toggle SAFE/YOLO execution policy",
    handler: async (ctx) => setMode(mode === "safe" ? "yolo" : "safe", ctx),
  });

  const cwd = process.cwd();
  const deferred = { exposure: "deferred", annotations: { readOnlyHint: true } } as const;

  pi.registerTool({
    name: changeMode,
    label: "Change Mode",
    exposure: "model-only",
    executionMode: "sequential",
    description: "Request user approval to switch from SAFE to YOLO mode.",
    promptSnippet: "Request user approval to lift SAFE execution restrictions",
    promptGuidelines: ["Use change_mode to request user approval when SAFE blocks a tool you need."],
    parameters: Type.Object({ mode: StringEnum(["yolo"] as const) }),
    async execute(_id, _params, signal, _onUpdate, ctx) {
      if (mode !== "safe") return approvalResult("YOLO is already active.", true);
      if (!ctx.hasUI) return approvalResult("User approval is unavailable without a UI.", true);
      const requestedAt = revision;
      const approved = await ctx.ui.confirm(
        "Allow mode change?",
        "The assistant requests switching to YOLO, which lifts SAFE restrictions on writes, edits, shell execution, and other mutating tools.",
        { signal },
      );
      if (signal?.aborted || requestedAt !== revision) return approvalResult("The permission request expired.", true);
      if (!approved) return approvalResult("User declined the switch to YOLO. SAFE remains active.");
      setMode("yolo", ctx);
      return approvalResult("User approved the switch to YOLO.");
    },
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("Change Mode")) + theme.fg("muted", " SAFE → YOLO"), 0, 0);
    },
  });

  pi.on("tool_call", (event) => {
    if (mode === "yolo") {
      if (event.toolName === changeMode) return { block: true, reason: "YOLO is already active." };
      return;
    }
    const tool = pi.getAllTools().find(({ name }) => name === event.toolName);
    if (blockedInSafe(event.toolName, tool)) {
      const guidance = pi.getActiveTools().includes(changeMode) ? " or request approval with change_mode" : "";
      return {
        block: true,
        reason: `Blocked by SAFE execution policy: ${event.toolName}. Use a read-only tool${guidance}.`,
      };
    }
  });

  registerModeNotice(pi, () => mode);
  registerViewer(pi, () => mode);

  pi.on("session_start", (_event, ctx) => {
    const overrides = new Set(pi.getAllTools().filter((tool) => tool.sourceInfo.source !== "builtin").map((tool) => tool.name));
    const ls = createLsToolDefinition(cwd);
    const grep = createGrepToolDefinition(cwd);
    const find = createFindToolDefinition(cwd);
    if (!overrides.has(ls.name)) pi.registerTool({ ...ls, ...deferred });
    if (!overrides.has(grep.name)) pi.registerTool({ ...grep, ...deferred });
    if (!overrides.has(find.name)) pi.registerTool({ ...find, ...deferred });
    clearInterval(footerRefresh);
    toolStatuses.clear();
    mode = restoreMode(ctx.sessionManager.getEntries());
    const active = pi.getActiveTools();
    const registered = new Set(pi.getAllTools().filter((tool) => tool.exposure !== "hidden").map((tool) => tool.name));
    const missing = entryPoints.filter((name) => registered.has(name) && !active.includes(name));
    if (missing.length) pi.setActiveTools([...active, ...missing]);
    updateStatus(ctx);
    if (ctx.mode !== "tui") return;

    // Background MCP connections can register tools without a registry change event.
    const timer = setInterval(() => {
      let currentMode: ExtensionContext["mode"];
      try {
        currentMode = ctx.mode;
      } catch {
        clearInterval(timer);
        return;
      }
      if (currentMode === "tui") updateToolStatuses(pi, ctx, toolStatuses);
    }, 250);
    footerRefresh = timer.unref();
  });
  pi.on("session_tree", (_event, ctx) => updateStatus(ctx));
  pi.on("agent_settled", (_event, ctx) => updateStatus(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    revision++;
    clearInterval(footerRefresh);
    if (ctx.mode === "tui") {
      for (const key of ["mode", "codemode", "tools", "mcp-tools"]) ctx.ui.setStatus(key, undefined);
    }
  });
}
