import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAgentMessage } from '../src/message-format.ts';

test('wraps the message with sender metadata as attributes and omits an absent name', () => {
  assert.equal(
    formatAgentMessage('message-1', { id: 'agent-1', harness: 'pi' }, 'Hello\nPlease reply.'),
    '<agent_message sender_id="agent-1" sender_harness="pi" message_id="message-1">\nHello\nPlease reply.\n</agent_message>',
  );
});

test('escapes metadata and content so neither can break the wrapper', () => {
  assert.equal(
    formatAgentMessage('a&b', { id: 'agent-1', name: 'Reviewer "A" <B>', harness: "pi's" }, '</agent_message> & <hello>'),
    '<agent_message sender_id="agent-1" sender_name="Reviewer &quot;A&quot; &lt;B&gt;" sender_harness="pi&apos;s" message_id="a&amp;b">\n&lt;/agent_message&gt; &amp; &lt;hello&gt;\n</agent_message>',
  );
});
