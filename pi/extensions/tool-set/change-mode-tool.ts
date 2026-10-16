import type { ToolSet } from "./contracts.ts";
/**
 * The `change_mode` tool.
 *
 * Lets the model ask the user for permission to leave SAFE mode when it needs
 * mutation or shell access. Its declaration stays stable in both modes.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { CHANGE_MODE_TOOL } from "./state.ts";

const PERMISSION_GUIDELINES = [
  "New sessions default to YOLO with SSH disconnected. Execution policy is independent of tool visibility. The latest execution-policy notice states whether SAFE or YOLO is active.",
  "In SAFE, mutation and shell tools are blocked at execution time, including calls through codemode. Use read-only tools instead.",
  'Local ls/grep/find and SSH tools are deferred: discover them with tool_search or call them through codemode.',
  'Use change_mode with mode "yolo" to request user approval before performing operations blocked by SAFE.',
];

interface ChangeModeResult {
  approved: boolean;
}

function errorResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: { approved: false } satisfies ChangeModeResult,
  };
}

export function registerChangeModeTool(pi: ExtensionAPI, toolSet: ToolSet) {
  pi.registerTool({
    name: CHANGE_MODE_TOOL,
    label: "Change Mode",
    exposure: "model-only",
    description:
      "Request user approval to switch from SAFE to YOLO mode when more tool access is needed.",
    promptSnippet:
      "Request user approval to switch from safe mode to yolo mode when more tool access is needed",
    promptGuidelines: PERMISSION_GUIDELINES,
    parameters: Type.Object({
      mode: StringEnum(["yolo"] as const, {
        description: "Target mode to switch to.",
      }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return errorResult("Error: user approval is unavailable without a UI");
      }
      if (toolSet.getMode() !== "safe") {
        return errorResult("Error: YOLO is already active");
      }

      const approved = await ctx.ui.confirm(
        "Allow mode change?",
        "The agent requests switching from SAFE to YOLO mode, allowing mutation and shell execution, including remote tools. Other permission guards still apply.",
      );

      if (approved) {
        toolSet.setMode(params.mode);
      }

      const text = approved
        ? "User approved switching to YOLO mode. SAFE execution restrictions are lifted; tool declarations are unchanged."
        : "User denied switching to YOLO mode; remaining in SAFE mode.";

      return {
        content: [{ type: "text", text }],
        details: { approved } satisfies ChangeModeResult,
      };
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("Change Mode"));
      text += theme.fg("muted", ` SAFE → ${args.mode.toUpperCase()}`);
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as ChangeModeResult | undefined;
      if (!details) {
        const first = result.content[0];
        return new Text(first?.type === "text" ? first.text : "", 0, 0);
      }

      return new Text(
        details.approved
          ? theme.fg("success", "✓ Approved")
          : theme.fg("warning", "✗ Denied — staying SAFE"),
        0,
        0,
      );
    },
  });
}
