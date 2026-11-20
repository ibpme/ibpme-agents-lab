import {
  createBashToolDefinition, createEditToolDefinition, createFindToolDefinition,
  createGrepToolDefinition, createLsToolDefinition, createReadToolDefinition, createWriteToolDefinition,
  type ExtensionAPI, type ExtensionToolContext, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { withSshDestination } from "../shared/ssh-destination.ts";
import { remoteTools } from "./operations.ts";
import type { SshConnection } from "./transport.ts";

type Operations = ReturnType<typeof remoteTools>;

export function destination(connection: SshConnection): string {
  return (connection.remote + ":" + connection.remoteCwd).replace(/[\x00-\x1f\x7f-\x9f]/g, (char) =>
    "\\x" + char.charCodeAt(0).toString(16).padStart(2, "0"));
}

export function registerSshTools(pi: ExtensionAPI, getConnection: () => SshConnection | undefined,
  markLost: (connection: SshConnection, ctx: ExtensionToolContext) => Promise<void>) {
  const cwd = process.cwd();

  function register<T extends TSchema>(
    local: ToolDefinition<T, any>,
    readOnlyHint: boolean,
    execute: (operations: Operations, ...args: Parameters<typeof local.execute>) => ReturnType<typeof local.execute>,
  ) {
    const name = local.name + "_remote";
    pi.registerTool({
      ...local,
      label: name,
      renderResult: withSshDestination<T>(local.renderResult),
      name,
      description: "On the connected SSH host: " + local.description,
      promptSnippet: "Run " + name + " on the connected SSH host",
      promptGuidelines: undefined,
      exposure: "deferred",
      annotations: { readOnlyHint },
      async execute(...args: Parameters<typeof local.execute>) {
        const connection = getConnection();
        if (!connection) throw new Error("SSH is disconnected. Ask the user to run /ssh user@host.");
        const target = destination(connection);
        const stamp = (result: Awaited<ReturnType<typeof local.execute>>) => ({
          ...result, details: { ...result.details, sshDestination: target },
        });
        const [id, input, signal, update, ctx] = args;
        try {
          return stamp(await execute(remoteTools(connection, signal, () => markLost(connection, ctx)), id, input, signal,
            update && ((partial) => update(stamp(partial))), ctx));
        } catch (error) {
          return stamp({
            isError: true,
            content: [{ type: "text", text: "SSH " + target + ": " + (error instanceof Error ? error.message : String(error)) }],
            details: undefined,
          });
        }
      },
    });
  }

  register(createReadToolDefinition(cwd), true, async (ops, id, input, signal, update, ctx) =>
    ops.read(await ops.pathFor(input.path)).execute(id, input, signal, update, ctx));
  register(createWriteToolDefinition(cwd), false, async (ops, id, input, signal, update, ctx) => {
    const path = await ops.pathFor(input.path);
    return ops.write(path).execute(id, { ...input, path }, signal, update, ctx);
  });
  register(createEditToolDefinition(cwd), false, async (ops, id, input, signal, update, ctx) => {
    const path = await ops.pathFor(input.path);
    return ops.edit(path).execute(id, { ...input, path }, signal, update, ctx);
  });
  register(createBashToolDefinition(cwd), false, (ops, ...args) => ops.bash.execute(...args));
  register(createLsToolDefinition(cwd), true, async (ops, id, input, signal, update, ctx) =>
    ops.ls(await ops.pathFor(input.path || ".")).execute(id, input, signal, update, ctx));
  register(createFindToolDefinition(cwd), true, async (ops, id, input, signal, update, ctx) =>
    ops.find(await ops.pathFor(input.path || ".")).execute(id, input, signal, update, ctx));
  register(createGrepToolDefinition(cwd), true, (ops, _id, input) => ops.grep(input));
}
