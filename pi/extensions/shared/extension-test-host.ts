import type { ExtensionAPI, ExtensionContext, ToolDefinition, ToolInfo } from "@earendil-works/pi-coding-agent";

/** In-process adapter for testing our extension registrations and event handlers, not Pi's dispatcher. */
export function extensionTestHost(initial: string[] = ["read", "write", "edit", "bash"]) {
  type Handler = (...args: any[]) => any;
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, ToolDefinition<any>>();
  const commands = new Map<string, { handler: Handler }>();
  const messages: { customType: string; content: unknown; display: boolean }[] = [];
  const entries: { type: string; customType: string; data: unknown }[] = [];
  let active = [...initial];
  let loadoutWrites = 0;
  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, [...handlers.get(name) ?? [], handler]);
      return () => handlers.set(name, handlers.get(name)!.filter((h) => h !== handler));
    },
    registerTool(tool: ToolDefinition<any>) { tools.set(tool.name, tool); },
    registerCommand(name: string, command: { handler: Handler }) { commands.set(name, command); },
    registerShortcut() {}, registerFlag() {}, getFlag() {},
    getSettings: () => ({}), getCommands: () => [],
    getActiveTools: () => [...active],
    getAllTools: () => [...tools.values()].map((tool) => ({
      ...tool, exposure: tool.exposure ?? "direct",
      sourceInfo: { source: "local", path: `<test:${tool.name}>`, scope: "temporary", origin: "top-level" },
    })) as ToolInfo[],
    setActiveTools(names: string[]) { active = [...names]; loadoutWrites++; },
    sendMessage(message: typeof messages[number]) { messages.push(message); },
    appendEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
  } as unknown as ExtensionAPI;
  const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value, style: (value: string) => value };
  const ctx = {
    cwd: process.cwd(), mode: "tui", hasUI: true,
    ui: { theme, setStatus() {}, notify() {}, confirm: async () => false },
    sessionManager: {
      getEntries: () => entries, getBranch: () => entries,
      buildSessionProjection: () => ({ messages: messages.map((message) => ({ role: "custom", ...message })) }),
    },
  } as unknown as ExtensionContext;
  return {
    pi, ctx, tools, commands, messages, entries, handlers,
    loadoutWrites: () => loadoutWrites,
    async emit(name: string, event: object = {}) {
      const results = [];
      for (const handler of handlers.get(name) ?? []) {
        const result = await handler({ type: name, context: { contextMessages: messages.map((message) => ({ role: "custom", ...message })) }, ...event }, ctx);
        results.push(result);
        if (result?.message) messages.push(result.message);
        for (const entry of result?.entries ?? []) {
          if (entry.type === "custom_message") messages.push(entry);
        }
      }
      return results;
    },
  };
}
