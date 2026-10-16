import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { createRouter, loadRoutingConfig } from '@agent-hub/spawner/routing';
import { resolveConfig } from './config.js';

export const routeUsage = `agent-hub route validate [--config PATH] [--directory PATH]
agent-hub route test [--config PATH] [--directory PATH] [PROMPT | --prompt TEXT | --stdin]
                     [--routing-hint TEXT] [--require-classifier]

Check model routing configuration without spawning Pi.
validate  Check every profile against Pi's local catalog and configured auth.
test      Route a delegated prompt. With no prompt or only one configured
          profile, resolve the default profile without calling System One.
--config defaults to routingConfigPath in the state directory's config.json.
--routing-hint supplies optional advisory routing context, not child instructions.
--require-classifier exits 2 unless System One selected the profile.
JSON output does not echo the prompt, agent hint, profile system instructions, or credentials.
TYPESAFE_API_KEY authenticates System 1. A real prompt test sends text to TypeSafe.`;

export async function route(args: string[]): Promise<number> {
  const action = args[0];
  if (action !== 'validate' && action !== 'test') throw new Error(routeUsage);
  const validate = action === 'validate';
  const { values, positionals } = parseArgs({ args: args.slice(1), allowPositionals: !validate, options: {
    config: { type: 'string' }, directory: { type: 'string' },
    ...(validate ? {} : { 'routing-hint': { type: 'string' }, prompt: { type: 'string' }, stdin: { type: 'boolean' }, 'require-classifier': { type: 'boolean' } }),
  } }) as { values: { config?: string; directory?: string; 'routing-hint'?: string; prompt?: string; stdin?: boolean; 'require-classifier'?: boolean }; positionals: string[] };
  const path = values.config ? resolve(values.config) : resolveConfig({ ...(values.directory ? { directory: resolve(values.directory) } : {}) }).routingConfigPath;
  if (!path) throw new Error('--config PATH is required when config.json sets no routingConfigPath');
  const router = createRouter(await loadRoutingConfig(path));
  if (validate) {
    const profiles = await router.validateProfiles();
    const valid = profiles.every(profile => profile.error === null);
    console.log(JSON.stringify({ enabled: router.enabled, valid, profiles }, null, 2));
    return valid ? 0 : 1;
  }
  if (positionals.length > 1 || [values.prompt !== undefined, positionals.length > 0, !!values.stdin].filter(Boolean).length > 1) throw new Error('Supply one prompt using --prompt, a positional argument, or --stdin');
  let prompt = values.prompt ?? positionals[0];
  if (values.stdin) {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > 256 * 1024) throw new Error('Prompt exceeds 256 KiB');
      chunks.push(buffer);
    }
    prompt = Buffer.concat(chunks).toString('utf8');
  }
  const result = await router.route(prompt, undefined, values['routing-hint']);
  const execution = result?.execution;
  console.log(JSON.stringify({
    enabled: router.enabled,
    routing: result?.routing ?? null,
    execution: execution ? { harness: execution.harness, provider: execution.provider, model: execution.model, effort: execution.effort, has_append_system_prompt: !!execution.append_system_prompt?.trim() } : null,
  }, null, 2));
  return values['require-classifier'] && result?.routing.source !== 'classifier' ? 2 : 0;
}
