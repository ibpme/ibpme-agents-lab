import { posix } from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  createBashToolDefinition, createFindToolDefinition, createLsToolDefinition, createReadToolDefinition,
  DEFAULT_MAX_BYTES, truncateHead, type AgentToolResult, type EditToolDetails, type EditToolInput,
  type GrepToolDetails, type GrepToolInput,
} from "@earendil-works/pi-coding-agent";
import { ConnectionLostError, RemoteAbortError, RemoteCommandError, shq, type RunOptions, type SshConnection } from "./transport.ts";

const mutationQueues = new WeakMap<SshConnection, Map<string, Promise<unknown>>>();

// Pi 1.5.2 exposes the tool factory publicly, but its reusable edit helpers are internal.
const editHelpersUrl = new URL("core/tools/edit-diff.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
type EditHelpers = typeof import("../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/edit-diff.js");

export function remoteTools(connection: SshConnection, signal: AbortSignal | undefined, markLost: () => Promise<void>) {
  const cwd = connection.remoteCwd;
  const run = async (command: string, options: RunOptions = {}) => {
    try {
      return await connection.run(command, { timeoutMs: 30_000, ...options, signal });
    } catch (error) {
      if (error instanceof ConnectionLostError) await markLost();
      throw error;
    }
  };
  const exec = async (command: string, stdin?: string) => {
    const result = await run(command, { stdin });
    if (result.code !== 0) throw new RemoteCommandError(result.code, result.stderr.toString());
    return result.stdout;
  };
  const command = (...args: string[]) => args.map(shq).join(" ");
  const runIn = (path: string, script: string) => command("cd", "--", path) + " && " + script;
  const pathFor = async (path: string) => {
    if (path.includes("\0")) throw new Error("Invalid remote path.");
    if (path === "~" || path.startsWith("~/")) {
      const home = (await exec('printf "%s" "$HOME"')).toString();
      if (!posix.isAbsolute(home)) throw new Error("SSH did not report an absolute home directory.");
      return path === "~" ? home : home + "/" + path.slice(2);
    }
    return posix.isAbsolute(path) ? path : cwd + "/" + path;
  };
  const stat = async (path: string) => {
    const quoted = shq(path);
    return (await exec("if [ -d " + quoted + " ]; then printf dir; elif [ -e " + quoted +
      " ]; then printf file; else printf missing; fi")).toString();
  };
  const readFile = (path: string) => exec(command("cat", "--", path));
  const access = async (path: string) => { await exec(command("test", "-r", path)); };
  const writeFile = async (path: string, content: string) => {
    await exec([
      "target=" + shq(path),
      'if [ -L "$target" ] || { [ -e "$target" ] && { [ ! -f "$target" ] || [ ! -w "$target" ]; }; }; then',
      '  printf "%s\\n" "Target is not a writable regular file: $target" >&2; exit 1',
      "fi",
      "tmp=$(mktemp -- " + shq(posix.join(posix.dirname(path), ".pi-ssh.XXXXXXXXXX")) + ") || exit",
      `trap 'rm -f -- "$tmp"' EXIT`,
      "trap 'exit 1' HUP INT TERM",
      'cat > "$tmp" || exit',
      'size=$(wc -c < "$tmp") || exit',
      'if [ "$size" -ne ' + Buffer.byteLength(content) + ' ]; then',
      '  printf "%s\\n" "Incomplete SSH write: received $size bytes" >&2; exit 1',
      "fi",
      'if [ -e "$target" ]; then',
      '  chmod --reference="$target" -- "$tmp" || exit',
      "else",
      '  mask=$(umask) && chmod "$(printf "%o" "$((0666 & ~mask))")" -- "$tmp" || exit',
      "fi",
      'mv -fT -- "$tmp" "$target"',
    ].join("\n"), content);
  };

  async function mutate<T>(inputPath: string, operation: (path: string) => Promise<T>): Promise<T> {
    const resolved = await exec(command("realpath", "-mz", "--", await pathFor(inputPath)));
    const path = resolved.toString().slice(0, -1);
    if (!posix.isAbsolute(path) || path.includes("\0") || !resolved.equals(Buffer.from(path + "\0"))) {
      throw new Error("SSH did not report an absolute UTF-8 file path.");
    }
    let queue = mutationQueues.get(connection);
    if (!queue) mutationQueues.set(connection, queue = new Map());
    const work = (queue.get(path) ?? Promise.resolve()).catch(() => {}).then(() => {
      if (signal?.aborted) throw new RemoteAbortError();
      return operation(path);
    });
    queue.set(path, work);
    try {
      return await work;
    } finally {
      if (queue.get(path) === work) queue.delete(path);
    }
  }

  const write = (inputPath: string, content: string): Promise<AgentToolResult<undefined>> => mutate(inputPath, async (path) => {
    await exec(command("mkdir", "-p", "--", posix.dirname(path)));
    await writeFile(path, content);
    return { content: [{ type: "text", text: "Successfully wrote to " + inputPath }], details: undefined };
  });

  const edit = ({ path: inputPath, edits }: EditToolInput): Promise<AgentToolResult<EditToolDetails>> => {
    if (!Array.isArray(edits) || !edits.length) {
      throw new Error("Edit tool input is invalid. edits must contain at least one replacement.");
    }
    return mutate(inputPath, async (path) => {
      await access(path);
      const raw = (await readFile(path)).toString();
      const { normalizeToLF, applyEditsToNormalizedContent, applyReplacementsToOriginal, generateEditDiff }:
        EditHelpers = await import(editHelpersUrl.href);
      const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
      const content = raw.slice(bom.length);
      const normalized = normalizeToLF(content);
      const { baseContent, newContent, replacements } = applyEditsToNormalizedContent(normalized, edits, inputPath);
      const details = generateEditDiff(inputPath, baseContent, newContent, replacements);
      await writeFile(path, bom + (content === normalized ? newContent : applyReplacementsToOriginal(content, replacements)));
      return { content: [{ type: "text", text: `Successfully replaced ${edits.length} block(s) in ${inputPath}.` }], details };
    });
  };

  async function search(script: string, executable: string) {
    const result = await run(script);
    if (result.code === 127) throw new Error("Install " + executable + " on the SSH host to use this tool.");
    if (result.code === 0) return result.stdout.toString();
    throw new RemoteCommandError(result.code, result.stderr.toString());
  }

  async function grep(input: GrepToolInput): Promise<AgentToolResult<GrepToolDetails>> {
    const root = await pathFor(input.path || ".");
    const kind = await stat(root);
    if (kind === "missing") throw new Error("Path not found: " + root);
    const limit = Math.max(1, Math.min(10_000, Math.floor(input.limit ?? 100)));
    const args = ["rg", "--no-config", "--json", "--hidden", "--line-buffered"];
    if (input.glob) args.push("--glob", input.glob.replace(/^(!?)(?:\.\/)+/, "$1"));
    if (input.literal) args.push("--fixed-strings");
    if (input.ignoreCase) args.push("--ignore-case");
    const context = Math.max(0, Math.min(1000, Math.floor(input.context ?? 0)));
    if (context) args.push("--context", String(context));
    args.push("--", input.pattern, kind === "dir" ? "." : root);
    const decoder = new StringDecoder("utf8");
    let pending = "";
    let matches = 0;
    let linesTruncated = false;
    let outputBytes = 0;
    let outputLines = 0;
    let lastFile = "";
    let trailingEnd = 0;
    const lines: string[] = [];
    function consume(row: string) {
      if (!row) return;
      const { type, data } = JSON.parse(row);
      if (type === "end" && matches === limit) return false;
      if (type !== "match" && type !== "context") return;
      const file = data.path.text ?? Buffer.from(data.path.bytes, "base64").toString();
      const lineNumber: number = data.line_number;
      const isMatch = type === "match" && matches < limit;
      if (matches === limit && (file !== lastFile || lineNumber > trailingEnd)) return false;
      if (isMatch && ++matches === limit) {
        lastFile = file;
        trailingEnd = lineNumber + context;
      }
      const line: string = (data.lines.text ?? Buffer.from(data.lines.bytes, "base64").toString()).replace(/\r?\n$/, "");
      const label = kind === "dir" ? file.replace(/^\.\//, "") : posix.basename(file);
      linesTruncated ||= line.length > 500;
      const formatted = [label, lineNumber, line.length > 500 ? line.slice(0, 500) + "…" : line].join(isMatch ? ":" : "-");
      if (outputBytes - 1 <= DEFAULT_MAX_BYTES) lines.push(formatted);
      outputBytes += Buffer.byteLength(formatted) + 1;
      outputLines++;
      if (matches === limit && lineNumber === trailingEnd) return false;
    }
    const script = "exec " + command(...args);
    const result = await run(kind === "dir" ? runIn(root, script) : script, {
      onData(chunk, source) {
        if (source === "stderr") return;
        const rows = decoder.write(chunk).split("\n");
        if (rows.length === 1) {
          pending += rows[0];
          return;
        }
        rows[0] = pending + rows[0];
        pending = rows.pop() ?? "";
        for (const row of rows) {
          if (consume(row) === false) {
            pending = "";
            return false;
          }
        }
      },
    });
    if (result.code === 127) throw new Error("Install ripgrep (rg) on the SSH host to use this tool.");
    if (result.code !== 0 && result.code !== 1) throw new RemoteCommandError(result.code, result.stderr.toString());
    if (pending) consume(pending + decoder.end());
    const truncation = truncateHead(lines.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
    truncation.totalBytes = Math.max(0, outputBytes - 1);
    truncation.totalLines = outputLines;
    const details: GrepToolDetails = {};
    const notices: string[] = [];
    if (matches === limit) {
      details.matchLimitReached = limit;
      notices.push("[" + limit + " matches limit reached]");
    }
    if (truncation.truncated) {
      details.truncation = truncation;
      notices.push("[Output truncated]");
    }
    if (linesTruncated) {
      details.linesTruncated = true;
      notices.push("[Some lines truncated]");
    }
    return { content: [{ type: "text", text: [matches ? truncation.content : "No matches found", ...notices].join("\n") }], details };
  }

  return {
    pathFor,
    read: (path: string) => createReadToolDefinition(cwd, { operations: {
      readFile: () => readFile(path),
      access: () => access(path),
      detectImageMimeType: async () => {
        const output = await exec("if command -v file >/dev/null 2>&1; then " +
          command("file", "--mime-type", "-b", "--", path) + "; fi");
        const mime = output.toString().trim();
        return ["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"].includes(mime) ? mime : null;
      },
    } }),
    write,
    edit,
    bash: createBashToolDefinition(cwd, { exposeSessionEnvironment: false, operations: {
      async exec(script, _cwd, { onData, timeout }) {
        const result = await run(runIn(cwd, "exec " + command("bash", "-c", script)),
          { onData, timeoutMs: timeout ? timeout * 1000 : undefined });
        return { exitCode: result.code };
      },
    } }),
    ls: (path: string) => createLsToolDefinition(cwd, { operations: {
      exists: async () => (await stat(path)) !== "missing",
      stat: async () => {
        const kind = await stat(path);
        if (kind === "missing") throw new Error("Path not found: " + path);
        return { isDirectory: () => kind === "dir" };
      },
      readdir: async () => {
        const root = shq(path);
        const output = await exec("for entry in " + root + "/* " + root + "/.[!.]* " + root + "/..?*; do " +
          'if [ -e "$entry" ] || [ -L "$entry" ]; then printf "%s\\0" "${entry##*/}"; fi; done');
        return output.toString().split("\0").filter(Boolean);
      },
    } }),
    find: (path: string) => createFindToolDefinition(cwd, { operations: {
      exists: async () => (await stat(path)) !== "missing",
      glob: async (pattern, _cwd, { limit }) => {
        const glob = pattern.replace(/^(\.\/)+/, "");
        const args = ["--glob", "--hidden", "--print0", "--exclude", ".git", "--exclude", "node_modules",
          "--max-results", String(Math.min(limit, 10_001))];
        if (glob.includes("/")) args.push("--full-path");
        args.push("--", glob);
        const fd = 'if command -v fd >/dev/null 2>&1; then fd=fd; else fd=fdfind; fi';
        const output = await search(runIn(path, '{ ' + fd + '; "$fd" ' + command(...args) + '; }'), "fd (or fdfind)");
        return output.split("\0").filter(Boolean);
      },
    } }),
    grep,
  };
}
