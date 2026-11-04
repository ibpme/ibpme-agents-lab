import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { FAST_STATUS_KEY } from "../contracts/status-keys.ts";

const ENTRY_TYPE = "openai-fast";

export function supportsFast(model: ExtensionContext["model"]): boolean {
  return !!model && (model.provider === "openai" || model.provider === "openai-codex" || model.provider.startsWith("openai:")) &&
    (model.api === "openai-responses" || model.api === "openai-codex-responses");
}

export default function (pi: ExtensionAPI) {
  let enabled = false;
  const updateStatus = (ctx: ExtensionContext) => {
    ctx.ui.setStatus(FAST_STATUS_KEY, enabled && supportsFast(ctx.model) ? ctx.ui.theme.fg("warning", "⚡ fast") : undefined);
  };

  pi.registerCommand("fast", {
    description: "Toggle OpenAI fast service tier (/fast on|off); may increase cost or quota usage",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (action && action !== "on" && action !== "off") {
        ctx.ui.notify("Usage: /fast [on|off]", "warning");
        return;
      }
      const next = action ? action === "on" : !enabled;
      if (next && !supportsFast(ctx.model)) {
        ctx.ui.notify("Select an OpenAI Responses model before enabling /fast.", "warning");
        return;
      }
      if (next !== enabled) {
        enabled = next;
        pi.appendEntry(ENTRY_TYPE, { enabled });
      }
      updateStatus(ctx);
      ctx.ui.notify(enabled
        ? 'Fast tier requested for OpenAI. Availability depends on your model/account; cost or quota usage may increase.'
        : "Fast tier override off; using the provider's default service tier.", "info");
    },
  });

  pi.on("before_provider_request", (event, ctx) => {
    // This hook exposes no request-model metadata. Match the active model and payload
    // conservatively so unrelated nested model calls are left untouched.
    if (!enabled || !supportsFast(ctx.model) || typeof event.payload !== "object" || event.payload === null ||
        !("model" in event.payload) || event.payload.model !== ctx.model?.id) return;
    // Codex calls this Fast in the UI but serializes it as "priority" on the wire.
    return { ...event.payload, service_tier: "priority" };
  });

  pi.on("session_start", (_event, ctx) => {
    enabled = false;
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === ENTRY_TYPE && typeof entry.data === "object" &&
          entry.data !== null && "enabled" in entry.data && typeof entry.data.enabled === "boolean") {
        enabled = entry.data.enabled;
      }
    }
    updateStatus(ctx);
  });
  pi.on("model_select", (_event, ctx) => updateStatus(ctx));
  pi.on("session_shutdown", (_event, ctx) => ctx.ui.setStatus(FAST_STATUS_KEY, undefined));
}
