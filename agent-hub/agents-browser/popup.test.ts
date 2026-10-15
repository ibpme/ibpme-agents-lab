import assert from "node:assert/strict";
import { test } from "node:test";
import { launcher, openPopup, shellQuote } from "./popup.ts";
import type { Runner } from "@agent-hub/registry/types";

const origin = { server: "/tmp/socket with spaces", paneId: "%7" };

test("popup preserves socket, pane, client, and registry directory", async () => {
  const calls: string[][] = [];
  const runner: Runner = async (command, args) => {
    calls.push([command, ...args]);
    return args.includes("display-message") ? "/dev/pts/5\n" : "";
  };
  await openPopup(origin, "/tmp/registry's data", runner);
  assert.deepEqual(calls[0], ["tmux", "-S", origin.server, "display-message", "-p", "-t", "%7", "#{client_name}"]);
  assert.deepEqual(calls[1], ["tmux", "-S", origin.server, "display-popup", "-c", "/dev/pts/5", "-E", "-w", "90%", "-h", "90%", "-T", "Agents",
    [launcher, "--direct", "--socket", origin.server, "--pane", "%7", "--client", "/dev/pts/5", "--directory", "/tmp/registry's data"].map(shellQuote).join(" ")]);
});

test("an explicit client bypasses tmux default-client inference", async () => {
  const calls: string[][] = [];
  await openPopup({ ...origin, client: "exact-client" }, undefined, async (command, args) => { calls.push([command, ...args]); return ""; });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("exact-client"));
});

test("popup errors propagate and a missing client does not launch", async () => {
  let calls = 0;
  await assert.rejects(openPopup(origin, undefined, async () => { calls++; return ""; }), /No attached/);
  assert.equal(calls, 1);
  await assert.rejects(openPopup({ ...origin, client: "client" }, undefined, async () => { throw new Error("popup unsupported"); }), /popup unsupported/);
});
