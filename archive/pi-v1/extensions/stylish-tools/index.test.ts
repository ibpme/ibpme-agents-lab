import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extensionTestHost } from "../shared/extension-test-host.ts";
import extension from "./index.ts";

test("local search tools are deferred, read-only, and executable without activation", async (t) => {
  const h = extensionTestHost();
  extension(h.pi);
  t.after(() => h.emit("session_shutdown"));
  const dir = await mkdtemp(join(tmpdir(), "deferred-search-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "fixture.txt"), "needle\n");
  for (const name of ["ls", "grep", "find"]) {
    const tool = h.tools.get(name)!;
    assert.equal(tool.exposure, "deferred", name);
    assert.equal(tool.annotations?.readOnlyHint, true, name);
    const params = name === "grep" ? { path: dir, pattern: "needle" }
      : name === "find" ? { path: dir, pattern: "*.txt" } : { path: dir };
    const result = await tool.execute(name, params, undefined, undefined, h.ctx as any);
    assert.match(JSON.stringify(result.content), /fixture.txt/);
  }
  assert.equal(h.loadoutWrites(), 0);
});
