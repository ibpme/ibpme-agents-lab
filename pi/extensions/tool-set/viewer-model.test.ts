import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";
import { toolStatus } from "./viewer-model.ts";

for (const [exposure, declared, expected] of [
  ["direct", true, /active.*blocked.*SAFE/i],
  ["deferred", true, /loaded.*deferred.*blocked.*SAFE/i],
  ["deferred", false, /deferred.*blocked.*SAFE/i],
  ["codemode", false, /codemode.*blocked.*SAFE/i],
] as const) {
  test(`viewer preserves ${exposure} reachability while showing SAFE denial (declared=${declared})`, () => {
    const status = toolStatus({ name: "write_remote", exposure } as ToolInfo,
      new Set(declared ? ["write_remote"] : []), { getMode: () => "safe", isBlockedInSafe: () => true });
    assert.match(status.label, expected);
    assert.equal(status.color, "warning");
  });
}
