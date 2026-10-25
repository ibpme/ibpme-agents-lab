import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import ssh2 from "ssh2";
import type { TUI } from "@earendil-works/pi-tui";
import { SshAuthTerminal } from "./auth-terminal.ts";
import { connectSsh } from "./connection.ts";
import { shq } from "./transport.ts";

test("real OpenSSH password authentication survives closing its modal PTY", { timeout: 20_000, skip: process.platform === "win32" }, async (t) => {
  const sshPath = spawnSync("which", ["ssh"], { encoding: "utf8" }).stdout?.trim();
  if (!sshPath) { t.skip("OpenSSH is not installed"); return; }
  const directory = mkdtempSync(join(tmpdir(), "ssh-modal-integration-"));
  const originalPath = process.env.PATH;
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  let acceptedPasswords = 0;
  const commands: string[] = [];
  const server = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
    client.on("error", () => {});
    client.on("authentication", (auth) => {
      if (auth.method === "password" && auth.username === "modal-user" && auth.password === "synthetic-password") {
        acceptedPasswords++;
        auth.accept();
      } else auth.reject(["password"]);
    });
    client.on("ready", () => client.on("session", (accept) => {
      accept().on("exec", (acceptExec, _reject, info) => {
        commands.push(info.command);
        const stream = acceptExec();
        if (info.command.includes("pwd")) stream.write("/project\n");
        stream.exit(0);
        stream.end();
      });
    }));
  });
  t.after(() => {
    process.env.PATH = originalPath;
    server.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const config = join(directory, "config");
  writeFileSync(config, `Host modal-test
  HostName 127.0.0.1
  Port ${address.port}
  User modal-user
  UserKnownHostsFile ${join(directory, "known_hosts")}
  GlobalKnownHostsFile /dev/null
  PreferredAuthentications password
  PubkeyAuthentication no
  IdentityAgent none
`);
  writeFileSync(join(directory, "ssh"), `#!/bin/sh\nexec ${shq(sshPath)} -F ${shq(config)} "$@"\n`, { mode: 0o700 });
  process.env.PATH = `${directory}:${originalPath}`;
  const frames: string[] = [];
  let hostApproved = false;
  let passwordSent = false;
  let modalClosed = false;
  const connection = await connectSsh("modal-test:/project", (args) => new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setInterval>;
    const modal = new SshAuthTerminal({ terminal: { rows: 32 }, requestRender() {} } as Pick<TUI, "terminal" | "requestRender">,
      args, (outcome) => {
        modalClosed = true;
        clearInterval(timer);
        if (outcome === "success") resolve();
        else reject(new Error(`SSH modal outcome: ${outcome}`));
      }, 10_000, t.signal);
    modal.focused = true;
    timer = setInterval(() => {
      const text = modal.render(100).join("\n");
      frames.push(text);
      if (!hostApproved && text.includes("Are you sure")) {
        hostApproved = true;
        modal.handleInput("yes");
        modal.handleInput("\r");
      }
      if (!passwordSent && /password:/i.test(text)) {
        passwordSent = true;
        modal.handleInput("synthetic-password");
        modal.handleInput("\r");
      }
      if (text.includes("SSH failed")) modal.handleInput("\r");
    }, 10);
  }), t.signal);
  try {
    assert.equal(hostApproved, true);
    assert.equal(passwordSent, true);
    assert.equal(modalClosed, true);
    assert.equal(acceptedPasswords, 1);
    assert.equal(connection.remoteCwd, "/project");
    // This uses the real multiplexed master after the bootstrap's PTY has closed.
    await connection.exec("true", { timeoutMs: 2_000 });
    assert.equal(acceptedPasswords, 1);
    assert.ok(commands.length >= 3);
    assert.doesNotMatch(frames.join("\n"), /synthetic-password/);
  } finally {
    await connection.close();
  }
});
