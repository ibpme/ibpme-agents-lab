import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readSettings, toggleKeys, writeEnabled } from "./config.ts";
import { buildTranscript, parseSuggestion, requestSuggestion } from "./generation.ts";

const ID = "prompt-suggestions";
const SUGGESTION_ITEM = Symbol(ID);
const REQUEST_TIMEOUT_MS = 10_000;

export default function promptSuggestions(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  const configPath = join(agentDir, "prompt-suggestions.json");
  let config = readSettings(configPath);
  let pending: { controller: AbortController; timer: ReturnType<typeof setTimeout> } | undefined;
  let offer: { leaf: string; item: { value: string; label: string; [SUGGESTION_ITEM]: true } } | undefined;
  let attemptedLeaf: string | undefined;
  let unavailable = false;
  let unsubscribe: (() => void) | undefined;

  function canSuggest(ctx: ExtensionContext, leaf: string): boolean {
    return config.enabled && ctx.isIdle() && !ctx.ui.getEditorText() && ctx.sessionManager.getLeafId() === leaf;
  }

  function currentOffer(ctx: ExtensionContext) {
    return offer && canSuggest(ctx, offer.leaf) ? offer.item : undefined;
  }

  function updateStatus(ctx: ExtensionContext): void {
    const state = !config.enabled ? "off" : pending ? "thinking…" : unavailable ? "unavailable" : "on";
    ctx.ui.setStatus(ID, ctx.ui.theme.fg("muted", `suggestions: ${state}`));
  }

  function clear(ctx: ExtensionContext): void {
    if (!pending && !offer && !unavailable) return;
    if (pending) {
      clearTimeout(pending.timer);
      pending.controller.abort();
      pending = undefined;
    }
    if (offer) ctx.ui.setWidget(ID, undefined);
    offer = undefined;
    unavailable = false;
    updateStatus(ctx);
  }

  async function generate(ctx: ExtensionContext): Promise<void> {
    const leaf = ctx.sessionManager.getLeafId();
    if (!leaf || attemptedLeaf === leaf || !canSuggest(ctx, leaf)) return;

    const transcript = buildTranscript(ctx);
    if (!transcript) return;
    attemptedLeaf = leaf;
    clear(ctx);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (pending?.controller !== controller) return;
      pending = undefined;
      controller.abort();
      unavailable = canSuggest(ctx, leaf);
      updateStatus(ctx);
    }, REQUEST_TIMEOUT_MS);
    pending = { controller, timer };
    updateStatus(ctx);

    try {
      const text = parseSuggestion(await requestSuggestion(config, transcript, controller.signal, ctx));
      if (pending?.controller !== controller || !canSuggest(ctx, leaf) || !text) return;
      offer = { leaf, item: { value: text, label: text, [SUGGESTION_ITEM]: true } };
      ctx.ui.setWidget(ID, (_tui, theme) => ({
        invalidate() {},
        render(width) {
          const item = currentOffer(ctx);
          if (!item || width < 8) return [];
          const hint = "Tab to accept";
          if (width < 24) return [theme.fg("muted", truncateToWidth(`↳ ${item.label}`, width))];
          const preview = truncateToWidth(`↳ ${item.label}`, width - visibleWidth(hint) - 2);
          return [theme.fg("dim", preview) + "  " + theme.fg("muted", hint)];
        },
      }), { placement: "belowEditor" });
    } catch {
      if (pending?.controller === controller) unavailable = canSuggest(ctx, leaf);
    } finally {
      clearTimeout(timer);
      if (pending?.controller === controller) {
        pending = undefined;
        updateStatus(ctx);
      }
    }
  }

  function setEnabled(enabled: boolean, ctx: ExtensionContext): void {
    const changed = config.enabled !== enabled;
    config = { ...config, enabled };
    if (changed) {
      clear(ctx);
      attemptedLeaf = undefined;
    }
    try {
      writeEnabled(configPath, enabled);
    } catch {
      ctx.ui.notify("Could not save the prompt suggestions preference", "error");
    }
    updateStatus(ctx);
    ctx.ui.notify(`Prompt suggestions ${enabled ? "on" : "off"}`, "info");
    if (changed && enabled) void generate(ctx);
  }

  pi.registerCommand("suggestions", {
    description: "Toggle follow-up prompt suggestions",
    async handler(args, ctx) {
      if (ctx.mode !== "tui") {
        if (ctx.hasUI) ctx.ui.notify("Prompt suggestions are available in the terminal UI", "info");
        return;
      }
      const choice = args.trim().toLowerCase();
      if (choice && choice !== "on" && choice !== "off") {
        ctx.ui.notify("Usage: /suggestions [on|off]", "error");
        return;
      }
      setEnabled(choice ? choice === "on" : !config.enabled, ctx);
    },
  });

  for (const key of toggleKeys(agentDir)) {
    pi.registerShortcut(key, {
      description: "Toggle follow-up prompt suggestions",
      handler(ctx) {
        if (ctx.mode === "tui") setEnabled(!config.enabled, ctx);
      },
    });
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    config = readSettings(configPath);
    updateStatus(ctx);
    unsubscribe = ctx.ui.onTerminalInput((data) => {
      if (!data || isKeyRelease(data) || (matchesKey(data, "tab") && currentOffer(ctx))) return;
      clear(ctx);
      return undefined;
    });
    ctx.ui.addAutocompleteProvider((base) => ({
      triggerCharacters: base.triggerCharacters,
      async getSuggestions(lines, row, col, options) {
        const item = options.force && lines.length === 1 && !lines[0] ? currentOffer(ctx) : undefined;
        return item ? { prefix: "", items: [item] } : base.getSuggestions(lines, row, col, options);
      },
      shouldTriggerFileCompletion(lines, row, col) {
        return (lines.length === 1 && !lines[0] && !!currentOffer(ctx)) ||
          (base.shouldTriggerFileCompletion?.(lines, row, col) ?? true);
      },
      applyCompletion(lines, row, col, item, prefix) {
        if (!(SUGGESTION_ITEM in item)) return base.applyCompletion(lines, row, col, item, prefix);
        // Pi resolves autocomplete asynchronously even when the suggestion is already available.
        if (item !== currentOffer(ctx)) return { lines, cursorLine: row, cursorCol: col };
        clear(ctx);
        return { lines: [item.value], cursorLine: 0, cursorCol: item.value.length };
      },
    }));
  });
  pi.on("agent_settled", (event, ctx) => {
    if (ctx.mode === "tui" && !event.aborted) void generate(ctx);
  });
  pi.on("agent_start", (_event, ctx) => clear(ctx));
  pi.on("input", (_event, ctx) => { clear(ctx); });
  pi.on("ui_prompt_start", (_event, ctx) => clear(ctx));
  pi.on("session_tree", (_event, ctx) => clear(ctx));
  pi.on("session_before_compact", (_event, ctx) => { clear(ctx); });
  pi.on("session_shutdown", (_event, ctx) => {
    unsubscribe?.();
    unsubscribe = undefined;
    clear(ctx);
    attemptedLeaf = undefined;
  });
}
