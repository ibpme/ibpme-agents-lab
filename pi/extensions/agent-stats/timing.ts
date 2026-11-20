import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface TurnTiming {
  elapsedMs: number;
  ttftMs?: number;
  generationMs?: number;
  toolWallMs?: number;
  attempts: number;
}

export function observeTurns(pi: ExtensionAPI, onTurnEnd: (id: string, timing: TurnTiming) => void): void {
  let turn: {
    start: number;
    request?: number;
    firstOutput?: number;
    responseEnd?: number;
    attempts: number;
    tools: Set<string>;
    toolStart?: number;
    toolWall: number;
  } | undefined;

  const reset = () => { turn = undefined; };
  pi.on("session_start", reset);
  pi.on("session_shutdown", reset);
  pi.on("agent_settled", reset);
  pi.on("turn_start", () => {
    turn = { start: performance.now(), attempts: 0, tools: new Set(), toolWall: 0 };
  });
  pi.on("before_provider_request", () => {
    if (!turn) return;
    turn.attempts++;
    turn.request = performance.now();
    turn.firstOutput = undefined;
    turn.responseEnd = undefined;
  });
  pi.on("message_update", (event) => {
    if (!turn || turn.firstOutput !== undefined) return;
    const type = event.assistantMessageEvent.type;
    if (type === "text_delta" || type === "thinking_delta" || type === "toolcall_delta") {
      turn.firstOutput = performance.now();
    }
  });
  pi.on("message_end", ({ message }) => {
    if (turn && message.role === "assistant") turn.responseEnd = performance.now();
  });
  pi.on("tool_execution_start", ({ toolCallId, parentToolCallId }) => {
    if (!turn || parentToolCallId !== undefined) return;
    if (turn.tools.size === 0) turn.toolStart = performance.now();
    turn.tools.add(toolCallId);
  });
  pi.on("tool_execution_end", ({ toolCallId, parentToolCallId }) => {
    if (!turn || parentToolCallId !== undefined || !turn.tools.delete(toolCallId)) return;
    if (turn.tools.size === 0 && turn.toolStart !== undefined) {
      turn.toolWall += performance.now() - turn.toolStart;
      turn.toolStart = undefined;
    }
  });
  pi.on("turn_end", ({ messageEntryId }) => {
    if (!turn) return;
    const { start, request, firstOutput, responseEnd, attempts, tools, toolWall } = turn;
    onTurnEnd(messageEntryId, {
      elapsedMs: Math.round(performance.now() - start),
      ttftMs: request === undefined || firstOutput === undefined ? undefined : Math.round(firstOutput - request),
      generationMs: firstOutput === undefined || responseEnd === undefined ? undefined : Math.round(responseEnd - firstOutput),
      toolWallMs: tools.size === 0 ? Math.round(toolWall) : undefined,
      attempts,
    });
    reset();
  });
}
