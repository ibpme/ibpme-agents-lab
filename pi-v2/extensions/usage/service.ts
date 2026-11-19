import type { AuthResult, Credential, ModelAuth } from "@earendil-works/pi-ai";
import type { ExtensionContext, ModelRegistry } from "@earendil-works/pi-coding-agent";
import {
  CHATGPT_USAGE_URL, PROVIDERS, UsageError, parseCodex, parseOpenCodeGo, record, usageTitle,
} from "./providers.ts";
import type { UsageProvider, UsageReport } from "./providers.ts";

const GO_URL = "https://opencode.ai/inference/go/v1/usage";
const CODEX_URL = "https://chatgpt.com/backend-api/wham/usage";
const MAX_BODY_BYTES = 1024 * 1024;

type Registry = Pick<ModelRegistry, "getAll" | "getRegisteredProviderIds" | "getProviderAuthStatus" | "getProviderAuth" | "getApiKeyAndHeaders">;
export type UsageContext = Pick<ExtensionContext, "model"> & { modelRegistry: Registry };
export interface UsageDependencies {
  fetch: typeof fetch;
  readCredential(provider: string): Credential | undefined;
}

export function selectProviders(args: string, ctx: UsageContext): UsageProvider[] {
  const aliases = ctx.modelRegistry.getRegisteredProviderIds().filter(
    (id): id is `openai:${string}` => /^openai:[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id),
  );
  const providers: UsageProvider[] = [...PROVIDERS, ...aliases];
  const arg = args.trim();
  if (arg && arg.toLowerCase() !== "all") {
    const provider = providers.find((id) => id === arg) ?? PROVIDERS.find((id) => id === arg.toLowerCase());
    if (!provider) throw new UsageError("Use /usage [all|opencode-go|openai|openai:<label>|openai-codex].");
    return [provider];
  }
  return providers.filter((provider) => ctx.modelRegistry.getProviderAuthStatus(provider).configured);
}

function bearer(auth: ModelAuth): string | undefined {
  const entry = Object.entries(auth.headers ?? {}).find(([key]) => key.toLowerCase() === "authorization");
  if (entry) return typeof entry[1] === "string" && /^Bearer\s+\S+$/i.test(entry[1])
    ? entry[1].replace(/^Bearer\s+/i, "") : undefined;
  return auth.apiKey;
}

function officialOrigin(value: string, expected: string): boolean {
  try { return new URL(value).origin === expected; } catch { return false; }
}

async function resolveAuth(
  provider: "opencode-go" | "openai-codex", ctx: UsageContext, signal: AbortSignal,
): Promise<{ result: AuthResult; token: string }> {
  const model = ctx.model?.provider === provider ? ctx.model
    : ctx.modelRegistry.getAll().find((candidate) => candidate.provider === provider);
  if (!model) throw new UsageError(`No ${usageTitle(provider)} model is registered in Pi.`);
  const origin = provider === "opencode-go" ? "https://opencode.ai" : "https://chatgpt.com";
  if (!officialOrigin(model.baseUrl, origin)) {
    throw new UsageError("Usage lookup is only supported for the official provider origin, not custom endpoints or proxies.");
  }
  let result: AuthResult | undefined;
  let effective: Awaited<ReturnType<Registry["getApiKeyAndHeaders"]>>;
  try {
    result = await ctx.modelRegistry.getProviderAuth(provider);
    signal.throwIfAborted();
    effective = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  } catch {
    throw new UsageError(`Could not resolve ${usageTitle(provider)} credentials. Check /login and try again.`);
  }
  if (!result || !effective.ok) throw new UsageError(`No usable ${usageTitle(provider)} credentials. Use /login ${provider}.`);
  if ([result.auth.baseUrl, effective.baseUrl].some((url) => url !== undefined && !officialOrigin(url, origin))) {
    throw new UsageError("Usage lookup cannot send custom-endpoint credentials to the official provider.");
  }
  const token = bearer(effective);
  if (!token || token !== bearer(result.auth)) {
    throw new UsageError("Effective model authorization differs from provider authorization; usage lookup was skipped.");
  }
  return { result, token };
}

function matchingOAuth(provider: UsageProvider, token: string, deps: UsageDependencies): Credential & { type: "oauth" } {
  const credential = deps.readCredential(provider);
  if (credential?.type !== "oauth" || credential.access !== token ||
    !credential.refresh || !Number.isFinite(credential.expires)) {
    throw new UsageError(`The resolved token does not match Pi's stored ${provider} OAuth login. Use /login ${provider}.`);
  }
  return credential;
}

function codexAccountId(token: string, stored: unknown): string {
  let claimed: unknown;
  try {
    const claims = record(JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")));
    claimed = record(claims?.["https://api.openai.com/auth"])?.chatgpt_account_id;
  } catch { /* A stored account ID also supports opaque access tokens. */ }
  if (typeof claimed === "string" && typeof stored === "string" && claimed !== stored) {
    throw new UsageError("Codex token and stored account ID disagree. Reconnect with /login openai-codex.");
  }
  const accountId = typeof stored === "string" && stored ? stored : claimed;
  if (typeof accountId !== "string" || !/^[\w-]{1,200}$/.test(accountId)) {
    throw new UsageError("Codex OAuth has no valid account ID. Reconnect with /login openai-codex.");
  }
  return accountId;
}

async function getJson(url: string, token: string, deps: UsageDependencies, signal: AbortSignal, accountId?: string): Promise<unknown> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  try {
    const response = await deps.fetch(url, {
      method: "GET", redirect: "error", signal: requestSignal,
      headers: {
        Authorization: `Bearer ${token}`, Accept: "application/json",
        "User-Agent": "llm-garage-pi-usage/1.0",
        ...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      const hint = response.status === 401 ? " Reconnect with /login."
        : response.status === 403 ? " This account or token may not have access to usage."
        : response.status === 429 ? " Try again later." : "";
      throw new UsageError(`Usage request failed (HTTP ${response.status}).${hint}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new UsageError("The usage endpoint returned an empty response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) throw new UsageError("The usage response exceeded the size limit.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new UsageError("The usage endpoint returned invalid JSON (possibly an unavailable route)."); }
  } catch (error) {
    if (error instanceof UsageError) throw error;
    if (signal.aborted) throw new UsageError("Usage lookup cancelled.");
    if (requestSignal.aborted) throw new UsageError("Usage request timed out after 10 seconds.");
    // Never display raw fetch/auth errors or server bodies: they may contain credentials.
    throw new UsageError("Could not reach the usage endpoint. Check your connection and try again.");
  }
}

async function query(provider: UsageProvider, ctx: UsageContext, deps: UsageDependencies, signal: AbortSignal): Promise<UsageReport> {
  signal.throwIfAborted();
  if (provider !== "opencode-go" && provider !== "openai-codex") {
    const status = ctx.modelRegistry.getProviderAuthStatus(provider);
    if (!status.configured) throw new UsageError(`No ${provider} login is configured. Use /login ${provider}.`);
    const oauth = provider.startsWith("openai:") || (status.source === "stored" && deps.readCredential(provider)?.type === "oauth");
    const notes = oauth
      ? [`Check ChatGPT plan usage at ${CHATGPT_USAGE_URL}. Open the page in the browser profile for this account.`]
      : ["OpenAI's organization Usage API requires a separate admin key.", "Review API usage at https://platform.openai.com/usage"];
    return { provider, title: oauth ? usageTitle(provider) : "OpenAI · API", windows: [], notes };
  }

  const { result, token } = await resolveAuth(provider, ctx, signal);
  signal.throwIfAborted();
  if (provider === "opencode-go") return parseOpenCodeGo(await getJson(GO_URL, token, deps, signal));
  if (result.source !== "OAuth") throw new UsageError("Codex usage requires OAuth. Use /login openai-codex.");
  const credential = matchingOAuth(provider, token, deps);
  const accountId = codexAccountId(token, credential.accountId);
  return parseCodex(await getJson(CODEX_URL, token, deps, signal, accountId));
}

export async function collectUsage(providers: readonly UsageProvider[], ctx: UsageContext, deps: UsageDependencies, signal: AbortSignal): Promise<UsageReport[]> {
  return Promise.all(providers.map(async (provider) => {
    try { return await query(provider, ctx, deps, signal); }
    catch (error) {
      return {
        provider, title: usageTitle(provider), windows: [],
        notes: [error instanceof UsageError ? error.message : "Usage lookup failed. Check credentials and try again."],
      };
    }
  }));
}
