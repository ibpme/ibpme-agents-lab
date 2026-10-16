interface Sender {
  id: string;
  name?: string;
  harness: string;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character]!);
}

export function formatAgentMessage(id: string, sender: Sender, content: string): string {
  const metadata = {
    sender_id: sender.id,
    ...(sender.name === undefined ? {} : { sender_name: sender.name }),
    sender_harness: sender.harness,
    message_id: id,
  };
  const attributes = Object.entries(metadata).map(([key, value]) => `${key}="${escapeXml(value)}"`).join(' ');
  return `<agent_message ${attributes}>\n${escapeXml(content)}\n</agent_message>`;
}
