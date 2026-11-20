import { posix } from "node:path";
import {
  createBashToolDefinition, createEditToolDefinition, createFindToolDefinition,
  createLsToolDefinition, createReadToolDefinition, createWriteToolDefinition,
  truncateHead, type AgentToolResult, type GrepToolDetails, type GrepToolInput,
} from "@earendil-works/pi-coding-agent";
import { ConnectionLostError, RemoteCommandError, shq, type RunOptions, type SshConnection } from "./transport.ts";

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
  const writeFile = async (path: string, content: string) => { await exec("cat > " + shq(path), content); };
  const access = async (path: string) => { await exec(command("test", "-r", path)); };

  async function search(script: string, executable: string, noMatches = false) {
    const result = await run(script);
    if (result.code === 127) throw new Error("Install " + executable + " on the SSH host to use this tool.");
    if (result.code === 0 || (noMatches && result.code === 1)) return result.stdout.toString();
    throw new RemoteCommandError(result.code, result.stderr.toString());
  }

  async function grep(input: GrepToolInput): Promise<AgentToolResult<GrepToolDetails>> {
    const root = await pathFor(input.path || ".");
    const kind = await stat(root);
    if (kind === "missing") throw new Error("Path not found: " + root);
    const limit = Math.max(1, Math.min(10_000, Math.floor(input.limit ?? 100)));
    const args = ["rg", "--no-config", "--json", "--hidden", "--max-count", String(limit + 1)];
    if (input.glob) args.push("--glob", input.glob.replace(/^(!?)(?:\.\/)+/, "$1"));
    if (input.literal) args.push("--fixed-strings");
    if (input.ignoreCase) args.push("--ignore-case");
    const context = Math.max(0, Math.min(1000, Math.floor(input.context ?? 0)));
    if (context) args.push("--context", String(context));
    args.push("--", input.pattern, kind === "dir" ? "." : root);
    const output = await search(kind === "dir" ? runIn(root, command(...args)) : command(...args), "ripgrep (rg)", true);
    let matches = 0;
    let linesTruncated = false;
    const lines: string[] = [];
    for (const row of output.split("\n")) {
      if (!row) continue;
      const { type, data } = JSON.parse(row);
      if (type !== "match" && type !== "context") continue;
      if (type === "match" && ++matches > limit) break;
      const file = data.path.text ?? Buffer.from(data.path.bytes, "base64").toString();
      const line: string = (data.lines.text ?? Buffer.from(data.lines.bytes, "base64").toString()).replace(/\r?\n$/, "");
      const separator = type === "match" ? ":" : "-";
      const label = kind === "dir" ? file.replace(/^\.\//, "") : posix.basename(file);
      linesTruncated ||= line.length > 500;
      lines.push([label, data.line_number, line.length > 500 ? line.slice(0, 500) + "…" : line].join(separator));
    }
    const truncation = truncateHead(lines.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
    const details: GrepToolDetails = {};
    const notices: string[] = [];
    if (matches > limit) {
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
    write: (path: string) => createWriteToolDefinition(cwd, { operations: {
      writeFile: (_path, content) => writeFile(path, content),
      mkdir: async () => { await exec(command("mkdir", "-p", "--", posix.dirname(path))); },
    } }),
    edit: (path: string) => createEditToolDefinition(cwd, { operations: {
      access: () => access(path), readFile: () => readFile(path),
      writeFile: (_path, content) => writeFile(path, content),
    } }),
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
