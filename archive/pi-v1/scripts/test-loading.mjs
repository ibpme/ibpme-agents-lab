import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const expected = manifest.pi.extensions.map((entry) => realpathSync(join(root, entry))).sort();
const temp = mkdtempSync(join(tmpdir(), "agents-lab-loading-"));
try {
  const agentDir = join(temp, "agent");
  mkdirSync(join(agentDir, "extensions"), { recursive: true });
  symlinkSync(root, join(agentDir, "extensions", "ibpme-pi-extensions"), "dir");
  const loader = new DefaultResourceLoader({
    cwd: temp,
    agentDir,
    settingsManager: SettingsManager.inMemory(),
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  for (const pass of ["load", "reload"]) {
    await loader.reload();
    const result = loader.getExtensions();
    assert.deepEqual(result.errors, [], `${pass} errors`);
    assert.deepEqual(result.warnings, [], `${pass} warnings`);
    assert.deepEqual(result.extensions.map((e) => realpathSync(e.resolvedPath)).sort(), expected, `${pass} extension set`);
  }
  // Only tool-set owns shutdown-sensitive global state; other handlers need a live UI context.
  const serviceKey = Symbol.for("llm-garage.pi-custom-extensions.tool-set");
  assert.ok(globalThis[serviceKey], "the real loader must publish the ToolSet service");
  const toolSet = loader.getExtensions().extensions.find((e) => e.resolvedPath.endsWith("tool-set/index.ts"));
  for (const handler of toolSet.handlers.get("session_shutdown") ?? []) await handler({ type: "session_shutdown" }, {});
  assert.equal(globalThis[serviceKey], undefined, "shutdown must unpublish the ToolSet service");
  console.log(`Loaded all ${expected.length} extensions exactly once; verified reload and ToolSet shutdown.`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
