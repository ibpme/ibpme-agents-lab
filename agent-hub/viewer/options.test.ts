import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOptions } from "./options.ts";
import { shellQuote } from "./popup.ts";
import { execFileSync } from "node:child_process";

test("outside tmux is read-only and direct-capable", () => {
  assert.equal(parseOptions([], {}).origin, undefined);
  assert.equal(parseOptions(["--direct"], {}).direct, true);
});
test("captures original tmux context and supports explicit keybinding context", () => {
  assert.deepEqual(parseOptions([], { TMUX: "/tmp/a,1,2", TMUX_PANE: "%3" }).origin, { server: "/tmp/a", paneId: "%3" });
  assert.deepEqual(parseOptions(["--direct", "--socket", "/tmp/other", "--pane", "%4", "--client", "/dev/pts/1"], {}).origin,
    { server: "/tmp/other", paneId: "%4", client: "/dev/pts/1" });
});
test("rejects invalid or incomplete arguments", () => {
  for (const args of [["--wat"], ["--pane"], ["--pane", "%x"], ["--socket", "relative", "--pane", "%1"], ["--socket", "/tmp/socket"], ["--client", "client"]]) {
    assert.throws(() => parseOptions(args, {}));
  }
});
test("popup shell arguments round-trip without expansion", () => {
  for (const value of ["normal", "with spaces", "a'b", "$(touch /tmp/never-agents-viewer); \" $HOME", "a\nb"]) {
    assert.equal(execFileSync("sh", ["-c", `printf %s ${shellQuote(value)}`], { encoding: "utf8" }), value);
  }
});
