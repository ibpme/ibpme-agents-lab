# Workspace conventions

[Documentation index](README.md) · [Agent hub](../README.md)

## Installation and commands

Use npm 10+ and Node.js 22.18+; npm 11.19 is the recorded package-manager version.
Run `npm ci` in `agent-hub/`. Commit only the root `package-lock.json`; do not
create per-package npm or Bun lockfiles. Everything runs on Node.

```bash
cd agent-hub
npm ci
npm run typecheck
npm test
# Or run both typechecking and tests:
npm run check
```

The root workspace list is deliberately dependency-ordered: registry, browser,
Pi, spawner, MCP, service. npm executes workspace scripts in that order.

TypeScript and the Node type definitions are development tools owned by the
workspace root. Runtime dependencies belong to the packages that use them.

### Dependency versions

An external dependency has one specifier across the workspace. Packages coupled
to a host runtime or protocol are pinned exactly: `@earendil-works/pi-*`,
`typebox`, `@modelcontextprotocol/sdk` and `typescript`. Everything else uses a
caret range. `npm run test:packages` enforces both rules.

The `@earendil-works/pi-*` packages track the newest Pi release. Pi substitutes
its own copies when it loads an extension, so the pinned versions are what
typechecking and the standalone viewer use; keep them equal to the current Pi
release, and in step with the sibling `pi/` package.

### Pi host packages

Pi supplies `@earendil-works/pi-ai`, `pi-agent-core`, `pi-coding-agent`,
`pi-tui` and `typebox` to the extensions it loads. Code that Pi loads (`pi/` and
the workspace packages it depends on, such as `viewer/`) declares the ones it
imports as `peerDependencies` with `"*"`, plus an exact `devDependencies` pin for
typechecking, tests and the standalone viewer. It never lists them in
`dependencies`, because a physical copy can bypass Pi's module mapping.

Code that runs outside Pi, such as the spawner's model-profile validator,
declares the packages it imports as ordinary `dependencies`. Production imports
must be declared in `dependencies` or `peerDependencies` of the importing
package; a dev dependency hoisted from another workspace does not count.
`npm run test:packages` checks these rules.

## Packages and public APIs

| Directory | Package | Public API |
|---|---|---|
| `registry/` | `@agent-hub/registry` | `/client`, `/types`, `/processes`, `/protocol`, `/paths`, `/daemon`, `/schemas/*`, `/publishers/claude/*` |
| `viewer/` | `@agent-hub/viewer` | `/browser`, `/reader`, `/tmux-actions`, `/view`, `/popup`, `/theme`, `/launcher` |
| `pi/` | `@agent-hub/pi` | `/listener`, `/listener/protocol`, `/spawn-lifecycle` |
| `spawner/` | `@agent-hub/spawner` | root client API, `/supervisor`, `/tmux`, `/routing` |
| `mcp/` | `@agent-hub/mcp` | CLI only; no library exports |
| `service/` | `@agent-hub/service` | the `agent-hub` CLI; no library exports |

There are two commands: `agent-hub` (service) for everything except MCP, and
`agents-mcp`. Other packages expose libraries only; `agent-hub` subcommands call
them. Packages are private and intended for this checkout; the workspace
conversion does not make them independently publishable or relocatable.

Declare every cross-package dependency using its workspace package version
(currently `0.1.0`). npm links matching local workspaces. Use package imports,
not sibling `src/` or `dist/` paths. Add explicit subpath exports only for APIs
that consumers actually need; do not expose all implementation files.

Registry wire types and schemas remain owned by the registry. There is no generic
shared package. The browser shares its implementation with Pi through explicit
entry points. The spawner resolves the lifecycle extension through
`import.meta.resolve('@agent-hub/pi/spawn-lifecycle')`, without importing it into
the supervisor process. Schema assets are likewise resolved through package
exports instead of assuming sibling directory locations.

Cross-package integration tests may use repository fixtures, such as the
spawner's fake Pi executable. Production code must not depend on sibling paths.
`npm run test:packages` checks workspace ordering, exported files, declared local
imports, and production relative-import boundaries.

## TypeScript and ESM

All packages use ESM and extend `tsconfig.base.json`, which contains the common
strict NodeNext policy. Nothing is compiled: Node 22.18+ runs the TypeScript
source by stripping types, and Pi's extension loader handles the Pi package.

- `tsc` only typechecks (`noEmit`). Relative imports use `.ts`
  (`allowImportingTsExtensions`) and package exports point to source files.
- Only erasable syntax is allowed (`erasableSyntaxOnly`): no `enum`, `namespace`
  or constructor parameter properties.
- Executables start with `#!/usr/bin/env -S node --disable-warning=ExperimentalWarning`
  so type stripping's notice stays off stderr; child Node processes pass the
  same flag.

Do not introduce TypeScript path aliases to bypass package exports. No CommonJS
build, bundler, project-reference graph, or monorepo task runner is needed.
