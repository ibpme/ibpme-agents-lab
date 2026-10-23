import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { extensionTestHost } from "../shared/extension-test-host.ts";
import { terminalAuthentication } from "./auth.ts";

test("terminal authentication restores Pi after success and failure", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ssh-ui-test-"));
  const originalPath = process.env.PATH;
  process.env.PATH = `${directory}:${originalPath}`;
  const streams = [process.stdin, process.stdout];
  const descriptors = streams.map((stream) => Object.getOwnPropertyDescriptor(stream, "isTTY"));
  for (const stream of streams) Object.defineProperty(stream, "isTTY", { value: true, configurable: true });
  t.after(() => {
    process.env.PATH = originalPath;
    streams.forEach((stream, index) => {
      const descriptor = descriptors[index];
      if (descriptor) Object.defineProperty(stream, "isTTY", descriptor);
      else Reflect.deleteProperty(stream, "isTTY");
    });
    rmSync(directory, { recursive: true, force: true });
  });
  t.mock.method(process.stdout, "write", () => true);
  const h = extensionTestHost();
  const events: string[] = [];
  h.ctx.ui.custom = (async (factory: any) => {
    let result: unknown;
    factory({
      stop: () => events.push("stop"),
      start: () => events.push("start"),
      requestRender: () => events.push("render"),
    }, h.ctx.ui.theme, undefined, (value: unknown) => { result = value; });
    return result;
  }) as ExtensionContext["ui"]["custom"];

  for (const status of [0, 255]) {
    writeFileSync(join(directory, "ssh"), `#!/bin/sh\nexit ${status}\n`, { mode: 0o700 });
    events.length = 0;
    const authenticate = terminalAuthentication(h.ctx)!;
    if (status === 0) await authenticate([]);
    else await assert.rejects(() => authenticate([]), /failed, was cancelled, or timed out/);
    assert.deepEqual(events, ["stop", "start", "render"]);
  }

  const headless = { ...h.ctx, mode: "rpc" } as ExtensionContext;
  assert.equal(terminalAuthentication(headless), undefined);
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  assert.equal(terminalAuthentication(h.ctx), undefined);
});
