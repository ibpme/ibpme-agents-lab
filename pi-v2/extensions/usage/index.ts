import { addAbortListener } from "node:events";
import { readStoredCredential, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { showDocument, type OpenDocument, type ViewerDocument } from "../shared/document-view.ts";
import { documentViewport } from "../shared/document-viewport.ts";
import { formatUsage, renderUsage } from "./formatting.ts";
import { PROVIDERS, UsageError, type UsageReport } from "./providers.ts";
import { collectUsage, selectProviders, type UsageDependencies } from "./service.ts";

const title = "Account Usage";
const loading = "Loading account usage…";

const openLocal: OpenDocument = async (ctx, document) => {
  await ctx.ui.custom<void>((tui, theme, _keys, done) => {
    const body = document.createBody?.(tui, theme) ?? new Text(document.content, 0, 0);
    return documentViewport(tui, theme, done, body, document.title, () => "↑↓ scroll · Esc/q close");
  });
};

async function showUsage(
  events: ExtensionAPI["events"],
  ctx: ExtensionCommandContext,
  lookup: () => Promise<UsageReport[]>,
  signal: AbortSignal,
): Promise<void> {
  if (ctx.mode !== "tui") {
    const reports = await lookup();
    if (signal.aborted) return;
    const report = formatUsage(reports);
    if (ctx.mode === "rpc") ctx.ui.notify(report, "info");
    else console.log(`${title}\n\n${report}`);
    return;
  }

  let result: { reports: UsageReport[]; capturedAt: number } | undefined;
  let redraw: (() => void) | undefined;
  const document: ViewerDocument = {
    title,
    content: loading,
    format: "text",
    createBody(tui, theme) {
      redraw = () => tui.requestRender();
      return {
        render(width) {
          return result
            ? renderUsage(result.reports, { now: result.capturedAt, theme, width })
            : [theme.fg("muted", loading)];
        },
        invalidate() {},
      };
    },
  };

  const viewer = showDocument(events, ctx, document, openLocal);
  const loadingReport = lookup().then((reports) => {
    if (signal.aborted) return;
    result = { reports, capturedAt: Date.now() };
    redraw?.();
  });
  let cancellation: ReturnType<typeof addAbortListener> | undefined;
  const cancelled = new Promise<void>((resolve) => {
    cancellation = addAbortListener(signal, () => resolve());
  });
  try {
    // Pi disposes open dialogs on reload without resolving their custom UI promises.
    await Promise.race([viewer, cancelled, loadingReport.then(() => viewer)]);
  } finally {
    cancellation?.[Symbol.dispose]();
    redraw = undefined;
  }
}

export default function usageExtension(pi: ExtensionAPI): void {
  let active: AbortController | undefined;

  function cancel(): void {
    active?.abort();
    active = undefined;
  }

  pi.on("session_start", cancel);
  pi.on("session_shutdown", cancel);
  pi.registerCommand("usage", {
    description: "Show account usage and quota resets for OpenCode Go and OpenAI",
    getArgumentCompletions: (prefix) => ["all", ...PROVIDERS]
      .filter((provider) => provider.startsWith(prefix))
      .map((provider) => ({ value: provider, label: provider })),
    handler: async (args, ctx) => {
      if (active) {
        ctx.ui.notify("A usage lookup is already running", "info");
        return;
      }
      const controller = new AbortController();
      active = controller;
      try {
        const providers = selectProviders(args, ctx);
        const deps: UsageDependencies = { fetch: globalThis.fetch, readCredential: readStoredCredential };
        const lookup = () => collectUsage(providers, ctx, deps, controller.signal);
        await showUsage(pi.events, ctx, lookup, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) {
          ctx.ui.notify(error instanceof UsageError ? error.message : "Usage lookup failed", "warning");
        }
      } finally {
        controller.abort();
        if (active === controller) active = undefined;
      }
    },
  });
}
