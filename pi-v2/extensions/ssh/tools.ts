import {
  createBashToolDefinition, createEditToolDefinition, createFindToolDefinition,
  createGrepToolDefinition, createLsToolDefinition, createReadToolDefinition, createWriteToolDefinition,
  type ExtensionAPI, type ExtensionToolContext, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { withSshDestination } from "../shared/ssh-destination.ts";
import { remoteTools } from "./operations.ts";
import type { SshConnection } from "./transport.ts";

type Routing = { cli: boolean; connection?: SshConnection; unavailable?: string };
type Operations = ReturnType<typeof remoteTools>;

export function destination(connection: SshConnection): string {
  return (connection.remote + ":" + connection.remoteCwd).replace(/[\x00-\x1f\x7f-\x9f]/g, (char) =>
    "\\x" + char.charCodeAt(0).toString(16).padStart(2, "0"));
}

export function registerSshTools(pi: ExtensionAPI, route: () => Routing,
  markLost: (connection: SshConnection, ctx: ExtensionToolContext) => Promise<void>) {
  const cwd = process.cwd();

  function register<T extends TSchema>(
    local: ToolDefinition<T, any>,
    readOnlyHint: boolean,
    deferred: boolean,
    execute: (operations: Operations, ...args: Parameters<typeof local.execute>) => ReturnType<typeof local.execute>,
  ) {
    for (const remoteName of [false, true]) {
      const description = remoteName ? "On the SSH host selected with /ssh: " + local.description : local.description;
      // The renderer is also used without tool-styling and when replaying a CLI-routed result.
      pi.registerTool({
        ...local,
        label: remoteName ? local.name + "_remote" : local.label,
        renderResult: withSshDestination<T>(local.renderResult),
        name: remoteName ? local.name + "_remote" : local.name,
        description,
        ...(remoteName ? { promptSnippet: description, promptGuidelines: undefined } : {}),
        ...(remoteName || deferred ? { exposure: "deferred" as const } : { defaultActive: false }),
        annotations: { readOnlyHint },
        async execute(...args: Parameters<typeof local.execute>) {
          const { cli, connection, unavailable } = route();
          if (!cli && !remoteName) return local.execute(...args);
          if (cli && remoteName) throw new Error("Use the unqualified tool in --ssh mode.");
          if (!connection) throw new Error(unavailable ?? "SSH is disconnected. Ask the user to run /ssh user@host.");
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
  }

  register(createReadToolDefinition(cwd), true, false, async (ops, id, input, signal, update, ctx) =>
    ops.read(await ops.pathFor(input.path)).execute(id, input, signal, update, ctx));
  register(createWriteToolDefinition(cwd), false, false, async (ops, id, input, signal, update, ctx) => {
    const path = await ops.pathFor(input.path);
    return ops.write(path).execute(id, { ...input, path }, signal, update, ctx);
  });
  register(createEditToolDefinition(cwd), false, false, async (ops, id, input, signal, update, ctx) => {
    const path = await ops.pathFor(input.path);
    return ops.edit(path).execute(id, { ...input, path }, signal, update, ctx);
  });
  register(createBashToolDefinition(cwd), false, false, (ops, ...args) => ops.bash.execute(...args));
  register(createLsToolDefinition(cwd), true, true, async (ops, id, input, signal, update, ctx) =>
    ops.ls(await ops.pathFor(input.path || ".")).execute(id, input, signal, update, ctx));
  register(createFindToolDefinition(cwd), true, true, async (ops, id, input, signal, update, ctx) =>
    ops.find(await ops.pathFor(input.path || ".")).execute(id, input, signal, update, ctx));
  register(createGrepToolDefinition(cwd), true, true, (ops, _id, input) => ops.grep(input));
}
