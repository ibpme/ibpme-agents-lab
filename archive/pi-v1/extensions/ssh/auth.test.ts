import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { extensionTestHost } from "../shared/extension-test-host.ts";
import { terminalAuthentication } from "./auth.ts";

test("authentication modal uses a real controlling PTY with password echo disabled", { timeout: 10_000 }, async (t) => {
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
  writeFileSync(join(directory, "ssh"), `#!/bin/sh
stty -echo < /dev/tty
printf 'Password: '
IFS= read -r password < /dev/tty
stty echo < /dev/tty
if [ "$password" = '密碼é🔑' ]; then exit 0; else exit 255; fi
`, { mode: 0o700 });
  const h = extensionTestHost();
  const frames: string[] = [];
  let submitted = false;
  h.ctx.ui.custom = (async (factory: any, options: any) => {
    assert.equal(options.overlay, true);
    assert.equal(options.overlayOptions.anchor, "center");
    return new Promise<unknown>((resolve, reject) => {
      let modal: any;
      let timer: ReturnType<typeof setInterval>;
      modal = factory({
        terminal: { rows: 30 }, requestRender() {},
        stop() { throw new Error("must not stop Pi's UI"); },
        start() { throw new Error("must not restart Pi's UI"); },
      }, h.ctx.ui.theme, undefined, (value: unknown) => {
        clearInterval(timer);
        modal?.dispose();
        resolve(value);
      });
      modal.focused = true;
      timer = setInterval(() => {
        try {
          const text = modal.render(80).join("\n");
          frames.push(text);
          if (text.includes("SSH failed")) throw new Error("PTY bootstrap failed");
          if (!submitted && text.includes("Password:")) {
            submitted = true;
            modal.handleInput("\x1b[200~密碼é🔑\x1b[201~");
            modal.handleInput("\x1b[13u");
          }
        } catch (error) {
          clearInterval(timer);
          reject(error);
          modal.dispose();
        }
      }, 10);
    });
  }) as ExtensionContext["ui"]["custom"];
  await terminalAuthentication(h.ctx)!(["--", "test-host"]);
  assert.equal(submitted, true);
  assert.doesNotMatch(frames.join("\n"), /密碼é🔑/);
  assert.deepEqual(h.messages, []);
  assert.equal(terminalAuthentication({ ...h.ctx, mode: "rpc" } as ExtensionContext), undefined);
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  assert.equal(terminalAuthentication(h.ctx), undefined);
});
