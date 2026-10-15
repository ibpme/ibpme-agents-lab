import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/route-test.js', import.meta.url));
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'routing-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'models.json'), JSON.stringify({ providers: {
    'routing-test': { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'test-no-network', models: [
      { id: 'general-model', reasoning: true }, { id: 'deep-model', reasoning: true }, { id: 'no-thinking', reasoning: false },
    ] },
  } }));
  const config = { routing: { enabled: true, default_profile: 'general', classifier: { timeout_ms: 1000 }, profiles: [
    { id: 'general', harness: 'pi', provider: 'routing-test', model: 'general-model', effort: 'medium', description: 'Ordinary work' },
    { id: 'deep', harness: 'pi', provider: 'routing-test', model: 'deep-model', effort: 'high', description: 'Difficult work', append_system_prompt: 'Private profile instructions' },
  ] } };
  const path = join(directory, 'routing.json');
  const save = () => writeFile(path, JSON.stringify(config));
  await save();
  const env = { ...process.env, PI_CODING_AGENT_DIR: directory, TYPESAFE_API_KEY: '' };
  const run = async (...args) => {
    try { return { ...(await execute(process.execPath, [cli, '--config', path, ...args], { env })), code: 0 }; }
    catch (error) { return { stdout: error.stdout, stderr: error.stderr, code: error.code }; }
  };
  return { config, path, env, save, run };
}

test('dry-run script validates local profiles and resolves missing-key fallback without spawning', async t => {
  const h = await fixture(t);
  const validation = await h.run('--validate-only');
  assert.equal(validation.code, 0, validation.stderr);
  assert.equal(JSON.parse(validation.stdout).valid, true);
  const result = await h.run('--prompt', 'Implement a focused change');
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.routing.source, 'fallback');
  assert.equal(output.routing.fallback_reason, 'classifier_unconfigured');
  assert.equal(output.execution.model, 'general-model');
  assert.doesNotMatch(result.stdout + result.stderr, /Implement a focused change|Private profile instructions|test-no-network/);
  assert.equal((await h.run('--prompt', 'task', '--require-classifier')).code, 2);
  const defaultResult = await h.run();
  assert.equal(JSON.parse(defaultResult.stdout).routing.source, 'default');
});

test('dry-run reports unknown models, incompatible effort, and unavailable default', async t => {
  const h = await fixture(t);
  h.config.routing.profiles[1].model = 'nonexistent'; await h.save();
  let result = await h.run('--validate-only');
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).profiles[1].error, 'unknown_chat_model');
  h.config.routing.profiles[1].model = 'no-thinking'; await h.save();
  result = await h.run('--validate-only');
  assert.equal(JSON.parse(result.stdout).profiles[1].error, 'unsupported_effort');
  h.config.routing.profiles[1].provider = 'typesafe';
  h.config.routing.profiles[1].model = 'jev-latest'; await h.save();
  result = await h.run('--validate-only');
  assert.equal(JSON.parse(result.stdout).profiles[1].error, 'classifier_not_chat_model');
  h.config.routing.profiles[0].model = 'nonexistent'; await h.save();
  result = await h.run('--prompt', 'task');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Default routing profile general unavailable: unknown_chat_model/);
});

test('dry-run routes through real SDK to a mock endpoint and prints selected settings only', async t => {
  const h = await fixture(t);
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'jev-latest', answers: { profile: { type: 'choice', choice: 'deep', confidence: 1, probabilities: { general: 0, deep: 1 } } }, usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  h.env.TYPESAFE_API_KEY = 'test-secret';
  h.env.TYPESAFE_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  const result = await h.run('Investigate this difficult issue', '--require-classifier');
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.routing.profile, 'deep');
  assert.equal(output.routing.source, 'classifier');
  assert.equal(output.execution.effort, 'high');
  assert.equal(output.execution.has_append_system_prompt, true);
  assert.doesNotMatch(result.stdout + result.stderr, /Private profile instructions|test-secret/);
});

test('dry-run rejects invalid config and ambiguous prompt input', async t => {
  const h = await fixture(t);
  assert.equal((await h.run('--prompt', 'task', 'second task')).code, 1);
  assert.equal((await h.run('--validate-only', '--prompt', 'task')).code, 1);
  assert.equal((await h.run('--prompt', '  ')).code, 1);
  h.config.routing.default_profile = 'missing'; await h.save();
  assert.equal((await h.run('--validate-only')).code, 1);
});

test('dry-run reads stdin and respects explicitly disabled routing', async t => {
  const h = await fixture(t);
  const child = spawn(process.execPath, [cli, '--config', h.path, '--stdin'], { env: h.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  child.stdin.end('Classify a prompt from stdin');
  assert.equal(await exited, 0, stderr);
  assert.equal(JSON.parse(stdout).routing.source, 'fallback');
  h.config.routing.enabled = false; await h.save();
  const result = await h.run('--prompt', 'task');
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { enabled: false, routing: null, execution: null });
});
