/**
 * SSH transport: spawns `ssh`, enforces timeouts/abort, tracks
 * live children, and classifies failures.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthenticateInteractively } from "./auth.ts";

export class TransportError extends Error {
  override readonly name: string = "TransportError";
}

export class ConnectionLostError extends TransportError {
  override readonly name = "ConnectionLostError";
}

export class RemoteCommandError extends Error {
  readonly name = "RemoteCommandError";
  readonly code: number | null;
  readonly stderr: string;
  constructor(code: number | null, stderr: string) {
    super(`Remote command failed (${code}): ${stderr}`);
    this.code = code;
    this.stderr = stderr;
  }
}

/** Message kept as `timeout:<seconds>` for compatibility with existing callers. */
export class RemoteTimeoutError extends Error {
  readonly name = "RemoteTimeoutError";
  readonly seconds: number;
  constructor(seconds: number) {
    super(`timeout:${seconds}`);
    this.seconds = seconds;
  }
}

export class RemoteAbortError extends Error {
  readonly name = "RemoteAbortError";
  constructor() {
    super("aborted");
  }
}

export interface RunOptions {
  stdin?: string | Buffer;
  maxBufferBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Streams stdout and stderr. Return false to finish the command early. */
  onData?: (chunk: Buffer, source: "stdout" | "stderr") => void | boolean;
}

export interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: Buffer;
}

/** Starts a background master without allowing prompts or askpass programs. */
function startMaster(args: string[], signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new RemoteAbortError()); return; }
    const child = spawn("ssh", args, { stdio: "ignore", env: { ...process.env, SSH_ASKPASS_REQUIRE: "never" } });
    const abort = () => { child.kill("SIGKILL"); };
    signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const timer = setTimeout(abort, 15_000);
    child.once("error", (error) => {
      cleanup();
      reject(new TransportError(`Failed to start ssh: ${error.message}`));
    });
    child.once("exit", (code) => {
      cleanup();
      if (signal?.aborted) reject(new RemoteAbortError());
      else resolve(code === 0);
    });
  });
}

/** Tool invocations may reuse the owned master, but must never authenticate themselves. */
export function sshBaseArgs(controlPath?: string): string[] {
  return [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-o", "ControlMaster=no",
    "-o", "ProxyCommand=false",
    "-o", "PermitLocalCommand=no",
    "-o", "ClearAllForwardings=yes",
    ...(controlPath ? ["-S", controlPath] : []),
  ];
}

const KILL_GRACE_MS = 2000;

/** Single-quote a string for POSIX sh. */
export function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Spawns one ssh invocation and resolves with its raw outcome. Never classifies. */
export function spawnRemote(
  remote: string,
  command: string,
  opts: RunOptions,
  children: Set<ChildProcess>,
  controlPath: string,
): Promise<RunResult & { timedOut: boolean; aborted: boolean }> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      resolve({ code: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), timedOut: false, aborted: true });
      return;
    }
    const child = spawn("ssh", [...sshBaseArgs(controlPath), "--", remote, command], {
      stdio: [opts.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    });
    children.add(child);

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let bytes = 0;
    let overflow = false;
    let aborted = false;
    let stopped = false;
    let streamError: { error: unknown } | undefined;
    let timer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    const kill = () => {
      if (killTimer) return;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      killTimer.unref();
    };

    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, opts.timeoutMs);
    }
    const onAbort = () => {
      aborted = true;
      kill();
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const collect = (destination: Buffer[], data: Buffer) => {
      bytes += data.length;
      if (bytes > (opts.maxBufferBytes ?? 32 * 1024 * 1024)) {
        overflow = true;
        kill();
      } else {
        destination.push(data);
      }
    };
    const stream = (data: Buffer, source: "stdout" | "stderr") => {
      if (stopped || streamError || aborted || timedOut) return;
      try {
        if (opts.onData?.(data, source) === false) {
          stopped = true;
          if (timer) clearTimeout(timer);
          kill();
        }
      } catch (error) {
        streamError = { error };
        kill();
      }
    };
    child.stdout?.on("data", (data: Buffer) => {
      if (opts.onData) stream(data, "stdout");
      else collect(stdout, data);
    });
    child.stderr?.on("data", (data: Buffer) => {
      if (stopped) return;
      collect(stderr, data);
      stream(data, "stderr");
    });

    if (opts.stdin !== undefined) {
      child.stdin?.on("error", () => {
        // EPIPE if ssh exits early; the close handler reports the real outcome.
      });
      child.stdin?.end(opts.stdin);
    }

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      children.delete(child);
    };

    child.on("error", (err) => {
      cleanup();
      reject(new TransportError(`Failed to start ssh: ${err.message}`));
    });
    child.on("close", (code) => {
      cleanup();
      if (streamError) {
        reject(streamError.error);
        return;
      }
      if (overflow) {
        reject(new TransportError("SSH output exceeded the buffer limit."));
        return;
      }
      resolve({
        code: stopped ? 0 : code,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        timedOut,
        aborted,
      });
    });
  });
}

function controlCommand(remote: string, controlPath: string, command: "check" | "exit"): Promise<boolean | undefined> {
  return new Promise((resolve) => {
    const child = spawn("ssh", ["-O", command, ...sshBaseArgs(controlPath), "--", remote], { stdio: "ignore" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === null ? undefined : code === 0);
    });
  });
}

/**
 * Long-lived handle to one remote host and working directory. Owns the set of
 * live ssh children so close() can tear down everything in flight.
 */
export class SshConnection {
  readonly remote: string;
  remoteCwd: string;
  private readonly children = new Set<ChildProcess>();
  private closed = false;
  private closing?: Promise<void>;
  private controlDirectory?: string;
  private controlPath?: string;

  constructor(remote: string, remoteCwd: string) {
    this.remote = remote;
    this.remoteCwd = remoteCwd;
  }

  /** Establishes and owns a master before exposing any remote tools. */
  async open(interactive?: AuthenticateInteractively, signal?: AbortSignal): Promise<void> {
    if (this.closed) throw new TransportError("SSH connection is closed.");
    if (this.controlPath) throw new TransportError("SSH connection is already open.");
    this.controlDirectory = mkdtempSync(join(tmpdir(), "pi-ssh-"));
    this.controlPath = join(this.controlDirectory, "s");
    const args = [
      "-o", "ConnectTimeout=10",
      "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=3",
      "-o", "ControlMaster=yes",
      "-o", "ControlPersist=no",
      "-o", "PermitLocalCommand=no",
      "-o", "ClearAllForwardings=yes",
      "-S", this.controlPath, "-f", "-N",
    ];
    try {
      const ready = await startMaster(["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", ...args, "--", this.remote], signal);
      if (!ready) {
        if (!interactive) {
          throw new TransportError("SSH requires authentication or host-key approval. Run /ssh in an interactive Pi terminal, or configure SSH keys and known_hosts.");
        }
        await interactive(["-o", "BatchMode=no", "-o", "StrictHostKeyChecking=ask", ...args, "--", this.remote]);
      }
      if (signal?.aborted) throw new RemoteAbortError();
      await this.exec("true", { timeoutMs: 15_000, signal });
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  /**
   * Runs a command. Resolves for any exit code, including non-zero.
   * Throws for timeout, cancellation, or transport failure.
   */
  async run(command: string, opts: RunOptions = {}): Promise<RunResult> {
    if (this.closed) throw new TransportError("SSH connection is closed.");
    if (!this.controlPath) throw new TransportError("SSH is not connected. Run /ssh to connect.");
    const result = await spawnRemote(this.remote, command, opts, this.children, this.controlPath);
    if (this.closed) throw new TransportError("SSH connection was closed.");
    if (result.aborted) throw new RemoteAbortError();
    if (result.timedOut) throw new RemoteTimeoutError((opts.timeoutMs ?? 0) / 1000);
    if (result.code === 255 && !(await controlCommand(this.remote, this.controlPath, "check"))) {
      throw new ConnectionLostError("SSH connection lost. Reconnect to the remote.");
    }
    return result;
  }

  /** Like run(), but throws RemoteCommandError on a non-zero exit and returns stdout. */
  async exec(command: string, opts: RunOptions = {}): Promise<Buffer> {
    const result = await this.run(command, opts);
    if (result.code !== 0) {
      throw new RemoteCommandError(result.code, result.stderr.toString());
    }
    return result.stdout;
  }

  /** Kills in-flight children and drops the ControlMaster socket. Idempotent. */
  close(): Promise<void> {
    this.closed = true;
    return this.closing ??= this.closeResources().finally(() => { this.closing = undefined; });
  }

  private async closeResources(): Promise<void> {
    for (const child of this.children) child.kill("SIGTERM");
    const exited = this.controlPath && await controlCommand(this.remote, this.controlPath, "exit");
    for (const child of this.children) child.kill("SIGKILL");
    if (this.controlPath && !exited && await controlCommand(this.remote, this.controlPath, "check") !== false) {
      throw new TransportError("Could not stop SSH master for " + this.remote + " (control socket: " + this.controlPath + ").");
    }
    if (this.controlDirectory) rmSync(this.controlDirectory, { recursive: true, force: true });
    this.controlPath = undefined;
    this.controlDirectory = undefined;
  }
}

export interface ParsedSshTarget {
  remote: string;
  /** Explicit remote path after the first ':', if given. */
  remoteCwd?: string;
}

/** Parses `host` or `user@host:/path`. Splits on the first ':' only. */
export function parseSshTarget(arg: string): ParsedSshTarget {
  if (!arg || arg.startsWith(":") || arg.startsWith("-") || /[\s\x00-\x1f\x7f]/.test(arg.split(":", 1)[0])) {
    throw new TransportError("Invalid SSH target. Expected user@host[:/path].");
  }
  const idx = arg.indexOf(":");
  if (idx === -1) return { remote: arg };
  return { remote: arg.slice(0, idx), remoteCwd: arg.slice(idx + 1) };
}
