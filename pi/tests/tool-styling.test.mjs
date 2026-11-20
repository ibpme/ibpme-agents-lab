import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import toolStyling from "../extensions/tool-styling/index.ts";

test("tool renderers sanitize arguments, output, and SSH labels before styling", () => {
  let resolveRenderer;
  toolStyling({ registerToolRenderer: (resolve) => { resolveRenderer = resolve; } });
  const check = (text) => assert.doesNotMatch(text, /[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
  const theme = {
    fg(_color, text) {
      check(text.replace(/\x1b\[(?:32|39)m/g, ""));
      return `\x1b[32m${text}\x1b[39m`;
    },
    bold(text) { check(text); return text; },
  };
  const render = (component) => {
    const text = component.render(120).join("\n");
    assert.match(text, /\x1b\[32m/);
    const unstyled = stripTerminalSequences(text);
    check(unstyled);
    return unstyled;
  };
  const unsafe = "\r\x00\x1b[31m\x1b[2A\x1b]0;hidden title\x07\x9d8;;hidden link\x9c";
  const context = { outputPad: 0, keyHint: () => "expand" };
  const options = { expanded: true, isPartial: false };
  const bash = resolveRenderer("bash_remote");
  assert.match(render(bash.renderCall({ command: `echo ${unsafe}hello` }, theme, context)), /echo hello/);
  const result = {
    content: [{ type: "text", text: `first\r\n\t${unsafe}second` }],
    details: { sshDestination: `test@${unsafe}host` },
  };
  for (const isError of [false, true]) {
    const rendered = render(bash.renderResult(result, options, theme, { ...context, isError }));
    assert.match(rendered, /SSH test@host/);
    assert.match(rendered, /first[^\n]*\n[^\n]* {3,}second/);
    assert.doesNotMatch(rendered, /hidden|\[2A/);
  }
  const grep = resolveRenderer("grep");
  assert.match(render(grep.renderCall({ glob: `${unsafe}*.ts` }, theme, context)), /glob=\*\.ts/);
  const edit = resolveRenderer("edit");
  assert.match(render(edit.renderResult({
    content: [], details: { diff: `${unsafe}+added`, fullOutputPath: `/tmp/${unsafe}output` },
  }, options, theme, context)), /\+added[\s\S]*Full output: \/tmp\/output/);
});
