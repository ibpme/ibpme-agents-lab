import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const packages = await Promise.all(manifest.workspaces.map(async directory => ({
  directory,
  ...JSON.parse(await readFile(new URL(`${directory}/package.json`, root), 'utf8')),
})));

test('workspaces declare local dependencies and are ordered for builds', () => {
  const positions = new Map(packages.map((pkg, index) => [pkg.name, index]));
  for (const [index, pkg] of packages.entries()) {
    assert.match(pkg.name, /^@agent-hub\//);
    assert.equal(pkg.type, 'module');
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      if (!positions.has(name)) continue;
      assert.equal(version, packages[positions.get(name)].version);
      assert.ok(positions.get(name) < index, `${pkg.name} must follow ${name}`);
    }
  }
});

// Packages coupled to a host runtime or protocol are pinned exactly; everything else uses a caret range.
const exactPins = [/^@earendil-works\/pi-/, /^typebox$/, /^@modelcontextprotocol\/sdk$/, /^typescript$/];

test('external dependencies use one specifier across the workspace', () => {
  const specifiers = new Map();
  for (const pkg of [{ name: manifest.name, ...manifest }, ...packages]) {
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      if (name.startsWith('@agent-hub/')) continue;
      if (exactPins.some(pattern => pattern.test(name))) assert.match(version, /^\d+\.\d+\.\d+$/, `${pkg.name}: ${name} must be pinned exactly`);
      else assert.match(version, /^\^\d+\.\d+\.\d+$/, `${pkg.name}: ${name} must use a caret range`);
      const previous = specifiers.get(name);
      assert.ok(!previous || previous.version === version, `${name}: ${previous?.pkg} uses ${previous?.version}, ${pkg.name} uses ${version}`);
      specifiers.set(name, { pkg: pkg.name, version });
    }
  }
});

// Pi supplies these to the extensions it loads and maps their imports to its own copies.
const piHostPackages = ['@earendil-works/pi-ai', '@earendil-works/pi-agent-core', '@earendil-works/pi-coding-agent', '@earendil-works/pi-tui', 'typebox'];

test('packages loaded by Pi take host packages as peers', () => {
  const byName = new Map(packages.map(pkg => [pkg.name, pkg]));
  const loaded = new Set();
  const visit = name => {
    if (loaded.has(name)) return;
    loaded.add(name);
    for (const dependency of Object.keys(byName.get(name).dependencies ?? {})) if (byName.has(dependency)) visit(dependency);
  };
  visit('@agent-hub/pi');
  for (const pkg of packages) {
    for (const name of piHostPackages) {
      const peer = pkg.peerDependencies?.[name];
      if (loaded.has(pkg.name)) assert.equal(pkg.dependencies?.[name], undefined, `${pkg.name}: ${name} must be a peer, not a dependency`);
      if (peer === undefined) continue;
      assert.equal(peer, '*', `${pkg.name}: peer ${name} must use "*"`);
      assert.ok(pkg.devDependencies?.[name], `${pkg.name}: peer ${name} needs a pinned dev dependency`);
    }
  }
});

test('every explicit export resolves to an existing package file', async () => {
  for (const pkg of packages) {
    for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
      if (subpath.includes('*')) continue;
      const specifier = pkg.name + (subpath === '.' ? '' : subpath.slice(1));
      const resolved = import.meta.resolve(specifier);
      await access(fileURLToPath(resolved));
      if (typeof target === 'object' && target.types) {
        await access(new URL(`${pkg.directory}/${target.types}`, root));
      }
    }
  }
  const schema = JSON.parse(await readFile(new URL(import.meta.resolve('@agent-hub/registry/schemas/agent-snapshot.schema.json')), 'utf8'));
  assert.equal(schema.type, 'object');
});

async function* sources(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'test', 'tests'].includes(entry.name)) continue;
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) yield* sources(url);
    else if (/\.(ts|mjs)$/.test(entry.name) && !entry.name.includes('.test.')) yield url;
  }
}

test('production code uses declared package imports rather than sibling paths', async () => {
  for (const pkg of packages) {
    const directory = new URL(`${pkg.directory}/`, root);
    // Production imports must not rely on dev dependencies, which may be hoisted from another package.
    const declared = new Set([pkg.name, ...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
    for await (const file of sources(directory)) {
      const content = await readFile(file, 'utf8');
      for (const match of content.matchAll(/(?:from\s*|import\s*\(|import\.meta\.resolve\s*\(|new URL\s*\()\s*["']([^"']+)["']/g)) {
        const specifier = match[1];
        if (specifier.startsWith('.')) {
          assert.ok(new URL(specifier, file).href.startsWith(directory.href), `${file.pathname}: sibling path ${specifier}`);
        } else if (!specifier.includes(':')) {
          const name = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
          assert.ok(declared.has(name), `${file.pathname}: ${pkg.name} must declare ${name} in dependencies or peerDependencies`);
        }
      }
    }
  }
});

test('package entry points load and implementation deep imports are blocked', async () => {
  const [registry, processes, spawner, supervisor, reader, listener] = await Promise.all([
    import('@agent-hub/registry/client'),
    import('@agent-hub/registry/processes'),
    import('@agent-hub/spawner'),
    import('@agent-hub/spawner/supervisor'),
    import('@agent-hub/viewer/reader'),
    import('@agent-hub/pi/listener'),
  ]);
  assert.equal(typeof registry.request, 'function');
  assert.equal(typeof processes.listProcesses, 'function');
  assert.equal(typeof spawner.createSpawnerClient, 'function');
  assert.equal(typeof supervisor.startSupervisor, 'function');
  assert.equal(typeof reader.readRegistry, 'function');
  assert.equal(typeof listener.startListener, 'function');
  for (const specifier of ['@agent-hub/registry/src/types.ts', '@agent-hub/spawner/dist/io.js', '@agent-hub/viewer/session.ts']) {
    await assert.rejects(import(specifier), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  }
});

test('workspace root owns the only dependency lockfile', async () => {
  await access(new URL('package-lock.json', root));
  for (const pkg of packages) {
    for (const name of ['package-lock.json', 'bun.lock', 'bun.lockb']) {
      await assert.rejects(access(new URL(`${pkg.directory}/${name}`, root)), { code: 'ENOENT' });
    }
  }
});
