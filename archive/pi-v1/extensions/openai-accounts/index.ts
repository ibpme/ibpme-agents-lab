import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { accountProvider, parseLabels } from "./provider.ts";
import { switchAccount } from "./switch.ts";

export default function (pi: ExtensionAPI) {
  let labels = ["work"];
  try {
    labels = parseLabels(JSON.parse(readFileSync(join(getAgentDir(), "openai-accounts.json"), "utf8")));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  for (const label of labels) pi.registerProvider(accountProvider(label));
  const providerIds = ["openai", ...labels.map((label) => `openai:${label}`)];
  pi.registerCommand("account", {
    description: "Switch OpenAI account (toggle two accounts, otherwise show a picker)",
    handler: async (args, ctx) => {
      if (args.trim() && args.trim() !== "switch") {
        ctx.ui.notify("Usage: /account or /account switch", "warning");
        return;
      }
      await switchAccount(pi, ctx, providerIds);
    },
  });
}
