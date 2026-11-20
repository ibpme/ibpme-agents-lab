import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { skillReport } from "./report.ts";

test("reports empty branches", async () => {
  assert.match(await skillReport(new Map(), "/"), /No skills loaded/);
});

test("estimates full files once, resolves relative paths, and tolerates missing files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "loaded-skills-"));
  try {
    await writeFile(join(cwd, "SKILL.md"), "😀".repeat(9));
    const report = await skillReport(new Map([["tdd", "SKILL.md"], ["missing", "gone.md"]]), cwd);
    assert.match(report, /tdd: ~3 tokens/);
    assert.match(report, /missing: tokens unavailable/);
    assert.match(report, /Total \(known files only\): ~3 tokens/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
