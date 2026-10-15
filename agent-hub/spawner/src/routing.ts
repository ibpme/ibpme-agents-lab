import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { choice, TypeSafeClient } from '@typesafe-ai/sdk';
import { createProfileValidator } from '@agent-hub/pi/routing';

export const effortSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const selector = z.string().trim().min(1).max(256).regex(/^[^\s\0]+$/);
export const profileSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  harness: z.literal('pi'), provider: selector, model: selector,
  effort: effortSchema,
  description: z.string().trim().min(1).max(4000),
  append_system_prompt: z.string().max(65536).refine(value => !value.includes('\0')).optional(),
});
const configSchema = z.strictObject({ routing: z.strictObject({
  enabled: z.boolean(),
  classifier: z.strictObject({
    model: selector.default('jev-latest'), timeout_ms: z.number().int().min(1).max(10000).default(3000),
  }).default({ model: 'jev-latest', timeout_ms: 3000 }),
  default_profile: z.string(),
  profiles: z.array(profileSchema).min(1).max(32),
}).superRefine((routing, ctx) => {
  const ids = routing.profiles.map(profile => profile.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Profile IDs must be unique' });
  if (!ids.includes(routing.default_profile)) ctx.addIssue({ code: 'custom', message: 'default_profile must reference a configured profile' });
}) });
export type RoutingConfig = z.infer<typeof configSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Execution = Pick<Profile, 'harness' | 'provider' | 'model' | 'effort' | 'append_system_prompt'>;
export interface RoutingDecision {
  source: 'classifier' | 'default' | 'fallback';
  profile: string;
  duration_ms: number;
  fallback_reason?: string;
  classified_profile?: string;
  unavailable_reason?: string;
}
export type ProfileValidator = (profile: Profile, signal: AbortSignal) => Promise<string | undefined>;
export type Classifier = (prompt: string, config: RoutingConfig['routing'], signal: AbortSignal, routing_hint?: string) => Promise<unknown>;
export interface RoutingDependencies { classify?: Classifier; validateProfile?: ProfileValidator }
export function parseRoutingConfig(value: unknown): RoutingConfig { return configSchema.parse(value); }
export async function loadRoutingConfig(path: string): Promise<RoutingConfig> {
  return parseRoutingConfig(JSON.parse(await readFile(path, 'utf8')));
}

const classify: Classifier = async (prompt, config, signal, routing_hint) => {
  if (!process.env.TYPESAFE_API_KEY?.trim()) throw new Error('classifier_unconfigured');
  const client = new TypeSafeClient({ logLevel: 'off', retry: { maxRetries: 0 }, timeout: config.classifier.timeout_ms });
  const response = await client.systemOne({
    model: config.classifier.model,
    state: { delegated_task: prompt, ...(routing_hint !== undefined ? { routing_hint: routing_hint } : {}) },
    questions: { profile: choice(
      "Which execution profile best matches the work required by delegated_task? Match the profile descriptions to the task's scope, reasoning depth, ambiguity, and cross-component dependencies. Judge the underlying work rather than prompt length or emphatic wording. Consider routing_hint, when present, for user-requested profiles, providers, models, or effort levels and the delegating agent's assessment. Prefer a profile matching an explicit user request when one is configured. Use the default profile when the task does not clearly match a more specific profile.",
      Object.fromEntries(config.profiles.map(profile => [profile.id, `${profile.description}\nProvider: ${profile.provider}\nModel: ${profile.model}\nEffort: ${profile.effort}${profile.id === config.default_profile ? '\nDefault profile.' : ''}`])),
    ) },
  }, { signal });
  return response.answers.profile.choice;
};

export function validateRoutingHint(value: unknown): asserts value is string | undefined {
  if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.includes('\0') || Buffer.byteLength(value) > 4096)) throw new Error('Invalid routing_hint (non-blank text, no NUL, maximum 4 KiB)');
}

// Enforce a wall-clock budget even if a dependency ignores cancellation.
async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, ms: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), ms);
  try {
    return await Promise.race([
      Promise.resolve().then(() => { controller.signal.throwIfAborted(); return operation(controller.signal); }),
      new Promise<never>((_, reject) => {
        if (controller.signal.aborted) reject(controller.signal.reason);
        else controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
      }),
    ]);
  } finally { clearTimeout(timer); parent?.removeEventListener('abort', abort); }
}

export function createRouter(configValue: RoutingConfig, dependencies: RoutingDependencies = {}) {
  const config = parseRoutingConfig(configValue).routing;
  const validateProfile = dependencies.validateProfile ?? createProfileValidator();
  const classifyPrompt = dependencies.classify ?? classify;
  const defaultProfile = config.profiles.find(profile => profile.id === config.default_profile)!;
  async function availability(profile: Profile, signal?: AbortSignal): Promise<string | undefined> {
    try {
      const error = await bounded(s => validateProfile(profile, s), 3000, signal);
      return error === undefined ? undefined : ['model_registry_error', 'classifier_not_chat_model', 'unknown_chat_model', 'unsupported_effort', 'missing_provider_auth'].includes(error) ? error : 'validation_failed';
    }
    catch { signal?.throwIfAborted(); return 'validation_failed'; }
  }
  return {
    enabled: config.enabled,
    async validateProfiles() {
      return Promise.all(config.profiles.map(async profile => ({ profile: profile.id, error: await availability(profile) ?? null })));
    },
    async route(prompt?: string, signal?: AbortSignal, routing_hint?: string): Promise<{ routing: RoutingDecision; execution: Execution } | undefined> {
      validateRoutingHint(routing_hint);
      if (!config.enabled) return undefined;
      if (prompt !== undefined && (!prompt.trim() || Buffer.byteLength(prompt) > 256 * 1024)) throw new Error('Invalid routing prompt (maximum 256 KiB)');
      signal?.throwIfAborted();
      const start = Date.now();
      let selected = defaultProfile;
      let source: RoutingDecision['source'] = 'default';
      let fallback_reason: string | undefined;
      let classified_profile: string | undefined;
      let unavailable_reason: string | undefined;
      if (prompt && config.profiles.length > 1) {
        try {
          const id = await bounded(s => classifyPrompt(prompt, config, s, routing_hint), config.classifier.timeout_ms, signal);
          const profile = config.profiles.find(profile => profile.id === id);
          if (!profile) throw new Error('invalid_selection');
          selected = profile; classified_profile = profile.id; source = 'classifier';
        } catch (error) {
          signal?.throwIfAborted();
          source = 'fallback';
          // Never persist API exception text, which may include prompts or credentials.
          const code = error instanceof Error ? error.message : '';
          fallback_reason = code === 'classifier_unconfigured' ? code : code === 'invalid_selection' ? 'classifier_invalid_selection' : code === 'timeout' ? 'classifier_timeout' : 'classifier_error';
        }
      }
      const error = await availability(selected, signal);
      if (error) {
        if (selected.id === defaultProfile.id) throw new Error(`Default routing profile ${defaultProfile.id} unavailable: ${error}`);
        unavailable_reason = error;
        selected = defaultProfile; source = 'fallback'; fallback_reason = 'selected_profile_unavailable';
        const defaultError = await availability(selected, signal);
        if (defaultError) throw new Error(`Default routing profile ${defaultProfile.id} unavailable: ${defaultError}`);
      }
      signal?.throwIfAborted();
      const { harness, provider, model, effort, append_system_prompt } = selected;
      return {
        routing: { source, profile: selected.id, duration_ms: Date.now() - start, ...(fallback_reason ? { fallback_reason } : {}), ...(classified_profile ? { classified_profile } : {}), ...(unavailable_reason ? { unavailable_reason } : {}) },
        execution: { harness, provider, model, effort, ...(append_system_prompt !== undefined ? { append_system_prompt } : {}) },
      };
    },
  };
}
