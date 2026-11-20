import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

type AccountContext = Pick<ExtensionCommandContext, "model" | "hasUI"> & {
  modelRegistry: Pick<ExtensionCommandContext["modelRegistry"], "getAvailable">;
  ui: Pick<ExtensionCommandContext["ui"], "notify" | "select">;
};

export async function switchAccount(
  pi: Pick<ExtensionAPI, "setModel">,
  ctx: AccountContext,
  providerIds: readonly string[],
): Promise<void> {
  const available = ctx.modelRegistry.getAvailable().filter((model) => providerIds.includes(model.provider));
  const accounts = [...new Set(available.map((model) => model.provider))];
  if (accounts.length < 2) {
    ctx.ui.notify("Log in to at least two OpenAI accounts with /login before switching.", "warning");
    return;
  }
  let target: string | undefined;
  if (accounts.length === 2 && ctx.model && accounts.includes(ctx.model.provider)) {
    target = accounts.find((account) => account !== ctx.model?.provider);
  } else {
    if (!ctx.hasUI) {
      ctx.ui.notify("Account selection requires an interactive UI. Use --provider instead.", "warning");
      return;
    }
    target = await ctx.ui.select("Switch OpenAI account", accounts);
  }
  if (!target || target === ctx.model?.provider) return;
  const model = available.find((candidate) => candidate.provider === target && candidate.id === ctx.model?.id);
  if (!model) {
    ctx.ui.notify(`The current model is not available under ${target}. Select a model with /model instead.`, "warning");
    return;
  }
  if (await pi.setModel(model)) ctx.ui.notify(`Account: ${target} · ${model.id}`, "info");
  else ctx.ui.notify(`Could not switch to ${target}. Check its login with /login.`, "error");
}
