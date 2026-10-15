# Workspace conventions

[Documentation index](README.md) · [Agent hub](../README.md)

## Installation and commands

Use npm 10+ and Node.js 22.18+; npm 11.19 is the recorded package-manager version.
Run `npm ci` in `agent-hub/`. Commit only the root `package-lock.json`; do not
create per-package npm or Bun lockfiles. Bun 1.3+ remains a **runtime** dependency
for the browser launcher and Pi's tmux popups, not the dependency installer.

```bash
cd agent-hub
npm ci
npm run build
npm run typecheck
npm test
# Or run both typechecking and tests:
npm run check
```

The root workspace list is deliberately dependency-ordered: registry, browser,
Pi, spawner, MCP. npm executes workspace scripts in that order. Root typecheck
and test commands build prerequisites automatically. For individual-package
commands, run the root build first; package scripts never build sibling packages.

TypeScript, tsx, and the Node type definitions are development tools owned by the
workspace root. Runtime dependencies belong to the packages that use them.

## Packages and public APIs

| Directory | Package | Public API |
|---|---|---|
| `registry/` | `@agent-hub/registry` | `/client`, `/types`, `/processes`, `/schemas/*` |
| `agents-browser/` | `@agent-hub/browser` | `/browser`, `/reader`, `/tmux-actions`, `/view`, `/popup` |
| `pi/` | `@agent-hub/pi` | `/listener`, `/listener/protocol`, `/spawn-lifecycle` |
| `spawner/` | `@agent-hub/spawner` | root client API, `/supervisor` |
| `mcp/` | `@agent-hub/mcp` | CLI only; no library exports |

CLI names remain `agents-registry`, `agents-browser`, `agents-spawner`, and
`agents-mcp`. Packages are private and intended for this checkout; the workspace
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
imports, and production relative-import boundaries; build first when running
that command on its own.

## TypeScript and ESM

All packages use ESM and extend `tsconfig.base.json`, which contains the common
strict NodeNext policy. There are intentionally two runtime profiles:

- **Compiled Node packages:** registry, spawner, and MCP emit JavaScript and
  declarations from `src/` to `dist/`. Relative imports use `.js`, matching the
  emitted files. Library exports point to JavaScript plus declaration files.
- **Source-loaded packages:** Pi extensions and browser code use `noEmit` and
  `allowImportingTsExtensions`. Their relative imports use `.ts`, and their
  exports point to source. Pi's extension loader and the Bun browser launcher
  handle those entry points. Node's TypeScript stripping runs their tests.

Do not replace these profiles with a single emit configuration or introduce
TypeScript path aliases to bypass package exports. No CommonJS build, bundler,
project-reference graph, or monorepo task runner is needed at this scale.
