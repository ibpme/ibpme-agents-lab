import { join, resolve } from 'node:path';
import { request } from '@agent-hub/registry/client';
import { registryDirectory } from '@agent-hub/registry/paths';
import { MAX_MESSAGE_BYTES, validateMessage } from '@agent-hub/registry/protocol';

export const publishUsage = `agent-hub publish [--directory PATH]

Read one versioned registry publisher message from stdin and send it to the
running registry.
  --directory PATH   State directory (AGENT_HUB_DIR, else XDG state/agent-hub)`;

export async function publish(args: string[]): Promise<void> {
  let directory = registryDirectory();
  for (let i = 0; i < args.length; i++) {
    const value = args[i + 1];
    if (args[i] !== '--directory') throw new Error(`Unknown option: ${args[i]}\n\n${publishUsage}`);
    if (!value || value.startsWith('--')) throw new Error('Missing value for --directory');
    directory = join(resolve(value), 'registry');
    i++;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_MESSAGE_BYTES) throw new Error('Message exceeds size limit');
    chunks.push(buffer);
  }
  const message = validateMessage(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if (message.type !== 'publish') throw new Error('publish requires a publish message');
  const response = await request(directory, message, 10000);
  if (!response.ok) throw new Error(response.error);
  console.log(JSON.stringify(response));
}
