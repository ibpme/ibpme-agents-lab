import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createRouter, parseRoutingConfig } from '../dist/routing.js';
import type { Classifier, RoutingDependencies } from '../src/routing.ts';

const config = () => parseRoutingConfig({ routing: {
  enabled: true, default_profile: 'general', classifier: { timeout_ms: 30 },
  profiles: [
    { id: 'general', harness: 'pi', provider: 'test', model: 'ordinary', effort: 'medium', description: 'Typical work', append_system_prompt: 'Default instructions' },
    { id: 'deep', harness: 'pi', provider: 'test', model: 'deep', effort: 'high', description: 'Complex work', append_system_prompt: 'Deep instructions' },
  ],
} });
const available: RoutingDependencies = { validateProfile: async () => undefined };

test('validates strict configuration, unique IDs, references, efforts, harnesses and bounds', () => {
  const base = config();
  assert.equal(base.routing.classifier.model, 'jev-latest');
  for (const mutate of [
    (c: any) => { c.routing.default_profile = 'missing'; },
    (c: any) => { c.routing.profiles.push(c.routing.profiles[0]); },
    (c: any) => { c.routing.profiles[0].harness = 'codex'; },
    (c: any) => { c.routing.profiles[0].effort = 'turbo'; },
    (c: any) => { c.routing.profiles[0].append_system_prompt = 'x'.repeat(65537); },
    (c: any) => { c.routing.profiles[0].provider = 'bad\0provider'; },
    (c: any) => { c.routing.profiles[0].secret = 'not-supported'; },
    (c: any) => { c.routing.classifier.timeout_ms = 10001; },
    (c: any) => { c.routing.enabled = 'true'; },
    (c: any) => { c.routing.profiles = []; },
  ]) {
    const value = structuredClone(base); mutate(value);
    assert.throws(() => parseRoutingConfig(value));
  }
});

test('selects a complete profile, isolates configuration, and does not rewrite the prompt', async () => {
  const input = config();
  const router = createRouter(input, { ...available, classify: async (prompt, routing) => {
    assert.equal(prompt, 'Delegated task');
    assert.equal(routing.profiles[1]!.description, 'Complex work');
    return 'deep';
  } });
  input.routing.profiles[1]!.model = 'mutated-after-startup';
  const result = (await router.route('Delegated task'))!;
  assert.equal(result.routing.source, 'classifier');
  assert.equal(result.routing.profile, 'deep');
  assert.equal(result.routing.classified_profile, 'deep');
  assert.deepEqual(result.execution, { harness: 'pi', provider: 'test', model: 'deep', effort: 'high', append_system_prompt: 'Deep instructions' });
});

test('disabled routing never calls classifier or model validator', async () => {
  const input = config(); input.routing.enabled = false;
  const never = async () => { throw new Error('Must not run'); };
  assert.equal(await createRouter(input, { classify: never, validateProfile: never }).route('task'), undefined);
});

test('no-prompt routing uses the default without classifying', async () => {
  const result = (await createRouter(config(), { ...available, classify: async () => { throw new Error('Must not classify'); } }).route())!;
  assert.equal(result.routing.source, 'default');
  assert.equal(result.execution.append_system_prompt, 'Default instructions');
});

for (const [name, classify, reason] of [
  ['unknown choice', async () => 'invented', 'classifier_invalid_selection'],
  ['malformed output', async () => ({ profile: 'deep' }), 'classifier_invalid_selection'],
  ['API failure', async () => { throw new Error('Secret credentials and prompt text'); }, 'classifier_error'],
  ['missing key', async () => { throw new Error('classifier_unconfigured'); }, 'classifier_unconfigured'],
  ['timeout', async () => new Promise(() => {}), 'classifier_timeout'],
] as const) {
  test(`${name} falls back to the full default profile without leaking errors`, async () => {
    const result = (await createRouter(config(), { ...available, classify: classify as Classifier }).route('task'))!;
    assert.equal(result.routing.source, 'fallback');
    assert.equal(result.routing.fallback_reason, reason);
    assert.equal(result.execution.model, 'ordinary');
    assert.equal(result.execution.append_system_prompt, 'Default instructions');
    assert.doesNotMatch(JSON.stringify(result), /Secret credentials/);
  });
}

test('an unavailable selected profile uses default, and unavailable default fails clearly', async () => {
  const router = createRouter(config(), { classify: async () => 'deep', validateProfile: async p => p.id === 'deep' ? 'unsupported_effort' : undefined });
  const result = (await router.route('task'))!;
  assert.equal(result.routing.source, 'fallback');
  assert.equal(result.routing.classified_profile, 'deep');
  assert.equal(result.routing.unavailable_reason, 'unsupported_effort');
  assert.equal(result.routing.fallback_reason, 'selected_profile_unavailable');
  assert.equal(result.execution.model, 'ordinary');
  assert.deepEqual(await router.validateProfiles(), [{ profile: 'general', error: null }, { profile: 'deep', error: 'unsupported_effort' }]);
  await assert.rejects(createRouter(config(), { classify: async () => 'deep', validateProfile: async () => 'unknown_chat_model' }).route('task'), /Default routing profile general unavailable: unknown_chat_model/);
});

test('shutdown cancellation propagates instead of falling back', async () => {
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const router = createRouter(config(), { ...available, classify: async (_prompt, _config, signal) => {
    started();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const pending = router.route('task', controller.signal);
  await ready; controller.abort(new Error('shutdown'));
  await assert.rejects(pending, /shutdown/);
});

test('rejects empty and oversized classification prompts', async () => {
  const router = createRouter(config(), available);
  await assert.rejects(router.route('  '), /Invalid routing prompt/);
  await assert.rejects(router.route('x'.repeat(256 * 1024 + 1)), /Invalid routing prompt/);
});

test('real TypeSafe SDK sends task context and profile execution metadata, excludes system instructions, and disables retries', async t => {
  const oldKey = process.env.TYPESAFE_API_KEY;
  const oldBase = process.env.TYPESAFE_BASE_URL;
  const requests: any[] = [];
  let fail = false;
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      requests.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(data) });
      res.writeHead(fail ? 503 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(fail ? { error: 'Private data' } : {
        model: 'jev-latest', answers: { profile: { type: 'choice', choice: 'deep', confidence: 0.9, probabilities: { general: 0.1, deep: 0.9 } } }, usage: { input_tokens: 10, output_tokens: 2 },
      }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.TYPESAFE_API_KEY = 'test-secret';
  process.env.TYPESAFE_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  t.after(async () => {
    if (oldKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = oldKey;
    if (oldBase === undefined) delete process.env.TYPESAFE_BASE_URL; else process.env.TYPESAFE_BASE_URL = oldBase;
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const input = config(); input.routing.classifier.timeout_ms = 1000;
  const router = createRouter(input, available);
  const result = (await router.route('Classify this task'))!;
  assert.equal(result.routing.source, 'classifier');
  assert.equal(result.routing.profile, 'deep');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].auth, 'Bearer test-secret');
  assert.deepEqual(requests[0].body.state, { delegated_task: 'Classify this task' });
  assert.equal(requests[0].body.questions.profile.instructions, "Which execution profile best matches the work required by delegated_task? Match the profile descriptions to the task's scope, reasoning depth, ambiguity, and cross-component dependencies. Judge the underlying work rather than prompt length or emphatic wording. Consider routing_hint, when present, for user-requested profiles, providers, models, or effort levels and the delegating agent's assessment. Prefer a profile matching an explicit user request when one is configured. Use the default profile when the task does not clearly match a more specific profile.");
  assert.deepEqual(requests[0].body.questions.profile.criteria, {
    general: 'Typical work\nProvider: test\nModel: ordinary\nEffort: medium\nDefault profile.',
    deep: 'Complex work\nProvider: test\nModel: deep\nEffort: high',
  });
  assert.doesNotMatch(JSON.stringify(requests[0].body), /Deep instructions|Default instructions/);
  const hinted = (await router.route('Same task', undefined, 'The user prioritizes careful investigation'))!;
  assert.deepEqual(requests[1].body.state, { delegated_task: 'Same task', routing_hint: 'The user prioritizes careful investigation' });
  assert.doesNotMatch(JSON.stringify(hinted), /careful investigation/);
  fail = true;
  assert.equal((await router.route('task'))!.routing.fallback_reason, 'classifier_error');
  assert.equal(requests.length, 3);
  delete process.env.TYPESAFE_API_KEY;
  assert.equal((await router.route('task'))!.routing.fallback_reason, 'classifier_unconfigured');
  assert.equal(requests.length, 3);
});

test('routing_hint is advisory routing context, not child instructions or a standalone task', async () => {
  let classifications = 0;
  const router = createRouter(config(), { ...available, classify: async (prompt, _config, _signal, hint) => {
    classifications++;
    assert.equal(prompt, 'Task unchanged');
    assert.equal(hint, 'Complexity assessment');
    return 'deep';
  } });
  const result = (await router.route('Task unchanged', undefined, 'Complexity assessment'))!;
  assert.equal(result.execution.append_system_prompt, 'Deep instructions');
  assert.doesNotMatch(JSON.stringify(result), /Complexity assessment/);
  assert.equal((await router.route(undefined, undefined, 'Context only'))!.routing.source, 'default');
  const disabled = config(); disabled.routing.enabled = false;
  assert.equal(await createRouter(disabled, { classify: async () => { throw new Error('Must not classify'); } }).route('Task', undefined, 'Context'), undefined);
  assert.equal(classifications, 1);
});

test('routing_hint validates type, non-blank text, NUL, and UTF-8 byte limits', async () => {
  const router = createRouter(config(), available);
  for (const hint of ['', '   ', 'invalid\0hint', 'x'.repeat(4097), '界'.repeat(1366), 123]) {
    await assert.rejects(router.route(undefined, undefined, hint as string), /Invalid routing_hint/);
  }
  assert.equal((await router.route(undefined, undefined, 'x'.repeat(4096)))!.routing.source, 'default');
  assert.equal((await router.route(undefined, undefined, '界'.repeat(1365)))!.routing.source, 'default');
});

test('single-profile routing validates and resolves the default without classifying', async () => {
  const input = config(); input.routing.profiles.splice(1);
  let classifications = 0;
  const validations: string[] = [];
  const router = createRouter(input, {
    classify: async () => { classifications++; throw new Error('Must not classify'); },
    validateProfile: async profile => { validations.push(profile.id); return undefined; },
  });
  for (const prompt of [undefined, 'Implement this task']) {
    const result = (await router.route(prompt, undefined, 'User prefers careful work'))!;
    assert.equal(result.routing.source, 'default');
    assert.equal(result.routing.profile, 'general');
    assert.equal(result.routing.fallback_reason, undefined);
    assert.equal(result.routing.classified_profile, undefined);
    assert.deepEqual(result.execution, { harness: 'pi', provider: 'test', model: 'ordinary', effort: 'medium', append_system_prompt: 'Default instructions' });
  }
  assert.equal(classifications, 0);
  assert.deepEqual(validations, ['general', 'general']);
});

test('single-profile routing still rejects unavailable models and invalid input', async () => {
  const input = config(); input.routing.profiles.splice(1);
  let classifications = 0;
  const router = createRouter(input, {
    classify: async () => { classifications++; return 'general'; },
    validateProfile: async () => 'missing_provider_auth',
  });
  await assert.rejects(router.route('Task'), /Default routing profile general unavailable: missing_provider_auth/);
  await assert.rejects(router.route('  '), /Invalid routing prompt/);
  await assert.rejects(router.route('x'.repeat(256 * 1024 + 1)), /Invalid routing prompt/);
  await assert.rejects(router.route('Task', undefined, '  '), /Invalid routing_hint/);
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  await assert.rejects(router.route('Task', controller.signal), /cancelled/);
  assert.equal(classifications, 0);
});
