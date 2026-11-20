import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { authenticationInput, SshAuthTerminal, type AuthOutcome, type SpawnAuthTerminal } from "./auth-terminal.ts";

function fixture(timeoutMs = 5_000, signal?: AbortSignal) {
  let output: ((text: string) => void) | undefined;
  let exit: ((event: { exitCode: number }) => void) | undefined;
  const writes: string[] = [];
  const sizes: [number, number][] = [];
  const outcomes: AuthOutcome[] = [];
  let killed = 0;
  let launches = 0;
  let redraws = 0;
  const spawn: SpawnAuthTerminal = (_args, cols, rows) => {
    launches++;
    sizes.push([cols, rows]);
    return {
      onData: (listener) => { output = listener; return { dispose: () => { output = undefined; } }; },
      onExit: (listener) => { exit = listener; return { dispose: () => { exit = undefined; } }; },
      write: (text) => { writes.push(String(text)); },
      resize: (cols, rows) => { sizes.push([cols, rows]); },
      kill: () => { killed++; }, pause() {}, resume() {},
    };
  };
  const terminal = { rows: 30 };
  const tui = { terminal, requestRender: () => { redraws++; } } as Pick<TUI, "terminal" | "requestRender">;
  const modal = new SshAuthTerminal(tui, ["--", "test-host"], (result) => outcomes.push(result), timeoutMs, signal, spawn);
  modal.focused = true;
  return {
    modal, terminal, writes, sizes, outcomes,
    output: (text: string) => output?.(text), exit: (code: number) => exit?.({ exitCode: code }),
    killed: () => killed, launches: () => launches, redraws: () => redraws,
  };
}

test("authentication input normalizes terminal protocols without submitting pasted credentials", () => {
  for (const [input, expected] of [
    ["password", "password"], ["密碼🔑", "密碼🔑"], ["\r", "\r"], ["\x7f", "\x7f"],
    ["\x1b[13u", "\r"], ["\x1b[127u", "\x7f"], ["\x1b[97u", "a"],
    ["\x1b[97:65;2u", "A"], ["\x1b[117;5u", "\x15"],
    ["\x1b[27;2;65~", "A"], ["\x1b[97;1:3u", ""],
    ["\x1b[A", ""], ["\x1b[57364u", ""], ["\x1b]52;c;data\x07", ""],
    ["\x1b[200~secret\r\nyes\x03\x1b[201~", "secretyes"],
  ]) assert.equal(authenticationInput(input), expected, JSON.stringify(input));
});

test("modal renders a bounded interpreted screen and never draws raw child escape sequences", async (t) => {
  const f = fixture();
  t.after(() => f.modal.dispose());
  f.modal.render(60);
  f.output("Password: \x1b]52;c;Y2xpcGJvYXJk\x07\x1b]0;bad-title\x07\x1b[2J\x1b[HHost fingerprint: SHA256:abc\r\n密碼: ");
  await delay(20);
  const lines = f.modal.render(60);
  assert.ok(lines.every((line) => visibleWidth(line) <= 60));
  assert.match(lines.join("\n"), /Host fingerprint: SHA256:abc/);
  assert.match(lines.join("\n"), /密碼/);
  assert.doesNotMatch(lines.join("\n"), /52;|bad-title|Y2xpcGJvYXJk|\x1b\[2J/);
  f.modal.handleInput("secret");
  assert.deepEqual(f.writes, ["secret"]);
  assert.doesNotMatch(f.modal.render(60).join("\n"), /secret/);
  f.terminal.rows = 18;
  f.modal.render(36);
  assert.deepEqual(f.sizes.at(-1), [32, 11]);
  assert.equal(f.launches(), 1);
  assert.ok(f.redraws() > 0);
});

test("success closes once without killing the exited bootstrap", () => {
  const f = fixture();
  f.modal.render(60);
  f.exit(0);
  f.modal.dispose();
  assert.deepEqual(f.outcomes, ["success"]);
  assert.equal(f.killed(), 0);
  f.modal.handleInput("must-not-write");
  assert.deepEqual(f.writes, []);
});

test("failed SSH stays visible until dismissed and does not forward more input", async () => {
  const f = fixture();
  f.modal.render(60);
  f.output("Permission denied\r\n");
  f.exit(255);
  await delay(20);
  assert.deepEqual(f.outcomes, []);
  assert.match(f.modal.render(60).join("\n"), /Permission denied/);
  assert.match(f.modal.render(60).join("\n"), /SSH failed/);
  f.modal.handleInput("secret");
  assert.deepEqual(f.writes, []);
  f.modal.handleInput("\r");
  assert.deepEqual(f.outcomes, ["failed"]);
});

for (const key of ["\x1b", "\x03", "\x1b[99;5u"]) {
  test(`cancellation kills the bootstrap and releases resources (${JSON.stringify(key)})`, () => {
    const f = fixture();
    f.modal.render(60);
    f.modal.handleInput(key);
    f.modal.dispose();
    assert.deepEqual(f.outcomes, ["cancelled"]);
    assert.equal(f.killed(), 1);
    assert.deepEqual(f.writes, []);
  });
}

test("timeout, abort, and external disposal settle pending authentication", async () => {
  const timed = fixture(10);
  timed.modal.render(60);
  await delay(30);
  assert.deepEqual(timed.outcomes, ["timeout"]);
  assert.equal(timed.killed(), 1);
  const controller = new AbortController();
  const aborted = fixture(5_000, controller.signal);
  aborted.modal.render(60);
  controller.abort();
  assert.deepEqual(aborted.outcomes, ["cancelled"]);
  assert.equal(aborted.killed(), 1);
  const disposed = fixture();
  disposed.modal.render(60);
  disposed.modal.dispose();
  assert.deepEqual(disposed.outcomes, ["cancelled"]);
  assert.equal(disposed.killed(), 1);
});

test("tiny terminals do not start SSH and remain cancellable", () => {
  const f = fixture();
  assert.ok(f.modal.render(5).every((line) => visibleWidth(line) <= 5));
  assert.equal(f.launches(), 0);
  f.modal.handleInput("\x1b");
  assert.deepEqual(f.outcomes, ["cancelled"]);
});

test("spawn failure remains dismissible", () => {
  const modal = new SshAuthTerminal({ terminal: { rows: 30 }, requestRender() {} } as Pick<TUI, "terminal" | "requestRender">,
    [], () => {}, 5_000, undefined, () => { throw new Error("native spawn failed"); });
  assert.match(modal.render(60).join("\n"), /SSH failed/);
  modal.handleInput("\r");
  assert.deepEqual(modal.render(60), []);
});
