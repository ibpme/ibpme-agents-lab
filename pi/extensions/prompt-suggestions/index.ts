import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readSettings, toggleKeys, writeEnabled } from "./config.ts";
import { buildTranscript, parseSuggestion, requestSuggestion, SuggestionModelUnavailableError } from "./generation.ts";

const ID = "prompt-suggestions";
const SUGGESTION_ITEM = Symbol(ID);
const REQUEST_TIMEOUT_MS = 10_000;
const LOADING_FRAMES = [".", "..", "..."];

export default function promptSuggestions(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  const configPath = join(agentDir, "prompt-suggestions.json");
  let config = readSettings(configPath);
  let pending: { controller: AbortController; timer: ReturnType<typeof setTimeout> } | undefined;
  let offer: { leaf: string; item: { value: string; label: string; [SUGGESTION_ITEM]: true } } | undefined;
  let attemptedLeaf: string | undefined;

  function canSuggest(ctx: ExtensionContext, leaf: string): boolean {
    return config.enabled && ctx.isIdle() && ctx.sessionManager.getLeafId() === leaf;
  }

  function currentOffer(ctx: ExtensionContext) {
    return offer && canSuggest(ctx, offer.leaf) && !ctx.ui.getEditorText() ? offer.item : undefined;
  }

  function showLoading(ctx: ExtensionContext): void {
    ctx.ui.setWidget(ID, (tui, theme) => {
      let frame = 0;
      const animation = setInterval(() => {
        frame = (frame + 1) % LOADING_FRAMES.length;
        tui.requestRender();
      }, 180);
      return {
        invalidate() {},
        render: (width) => width > 0 ? [theme.fg("muted", LOADING_FRAMES[frame].slice(0, width))] : [],
        dispose: () => clearInterval(animation),
      };
    }, { placement: "aboveEditor" });
  }

  function showPreview(ctx: ExtensionContext): void {
    ctx.ui.setWidget(ID, (_tui, theme) => ({
      invalidate() {},
      render(width) {
        const item = currentOffer(ctx);
        if (!item || width <= 0) return [];

        const hint = "Tab to accept";
        const previewWidth = width - visibleWidth(hint) - 2;
        const preview = `↱ ${item.label}`;
        return [previewWidth >= 8
          ? theme.fg("muted", truncateToWidth(preview, previewWidth)) + "  " + theme.fg("dim", hint)
          : theme.fg("muted", truncateToWidth(preview, width))];
      },
    }), { placement: "aboveEditor" });
  }

  function clear(ctx: ExtensionContext): void {
    if (!pending && !offer) return;
    if (pending) {
      const { controller, timer } = pending;
      pending = undefined;
      clearTimeout(timer);
      controller.abort();
    }
    offer = undefined;
    ctx.ui.setWidget(ID, undefined);
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
      clear(ctx);
      if (canSuggest(ctx, leaf)) ctx.ui.notify("Follow-up suggestion timed out", "warning");
    }, REQUEST_TIMEOUT_MS);
    pending = { controller, timer };
    showLoading(ctx);

    try {
      const text = parseSuggestion(await requestSuggestion(config, transcript, controller.signal, ctx));
      if (pending?.controller !== controller || !canSuggest(ctx, leaf)) return;
      if (!text) {
        ctx.ui.notify("No follow-up suggestion available", "info");
        return;
      }
      offer = { leaf, item: { value: text, label: text, [SUGGESTION_ITEM]: true } };
      showPreview(ctx);
    } catch (error) {
      if (pending?.controller !== controller || !canSuggest(ctx, leaf)) return;
      if (error instanceof SuggestionModelUnavailableError) {
        ctx.ui.notify("Follow-up suggestion model unavailable", "warning");
      } else {
        ctx.ui.notify("Could not load a follow-up suggestion", "error");
      }
    } finally {
      if (pending?.controller === controller) {
        clearTimeout(timer);
        pending = undefined;
        if (!offer) ctx.ui.setWidget(ID, undefined);
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
    clear(ctx);
    attemptedLeaf = undefined;
  });
}
