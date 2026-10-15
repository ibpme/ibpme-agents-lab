#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { createRouter, loadRoutingConfig } from './routing.js';

const help = `Usage: node spawner/dist/route-test.js --config PATH [--prompt TEXT | --stdin | --validate-only] [--require-classifier]

Validate routing configuration and test a delegated prompt without spawning Pi.
A positional prompt is also accepted. With no prompt, resolve the default profile.
--validate-only checks all profiles against Pi's local catalog and configured auth.
--require-classifier exits 2 if a prompt used fallback instead of System 1.
JSON output does not echo the prompt, profile system instructions, or credentials.
TYPESAFE_API_KEY authenticates System 1. A real prompt test sends text to TypeSafe.
Build first: npm run build --workspace @agent-hub/spawner`;

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    config: { type: 'string' }, prompt: { type: 'string' }, stdin: { type: 'boolean' },
    'validate-only': { type: 'boolean' }, 'require-classifier': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) { console.log(help); return; }
  if (!values.config) throw new Error('--config PATH is required');
  if (positionals.length > 1 || [values.prompt !== undefined, positionals.length > 0, !!values.stdin].filter(Boolean).length > 1) throw new Error('Supply one prompt using --prompt, a positional argument, or --stdin');
  if (values['validate-only'] && (values.prompt !== undefined || positionals.length || values.stdin || values['require-classifier'])) throw new Error('--validate-only cannot be combined with a prompt or --require-classifier');
  const config = await loadRoutingConfig(resolve(values.config));
  const router = createRouter(config);
  if (values['validate-only']) {
    const profiles = await router.validateProfiles();
    const valid = profiles.every(profile => profile.error === null);
    console.log(JSON.stringify({ enabled: router.enabled, valid, profiles }, null, 2));
    if (!valid) process.exitCode = 1;
    return;
  }
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
  const result = await router.route(prompt);
  const execution = result?.execution;
  console.log(JSON.stringify({
    enabled: router.enabled,
    routing: result?.routing ?? null,
    execution: execution ? { harness: execution.harness, provider: execution.provider, model: execution.model, effort: execution.effort, has_append_system_prompt: !!execution.append_system_prompt?.trim() } : null,
  }, null, 2));
  if (values['require-classifier'] && result?.routing.source !== 'classifier') process.exitCode = 2;
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Routing test failed'); process.exitCode = 1; });
