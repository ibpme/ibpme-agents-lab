import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { foregroundAnsi, indexedColor, parseColor, rgbColor } from "@earendil-works/pi-tui";
import type { Color, TerminalColorMode } from "@earendil-works/pi-tui";
import { contrastRatio, messageForeground } from "./message-colors.ts";

function emittedColors(text: string): Color[] {
  return [...text.matchAll(/\x1b\[38;(?:2;(\d+);(\d+);(\d+)|5;(\d+))m/g)]
    .map(match => match[4] !== undefined ? indexedColor(Number(match[4])) : rgbColor(Number(match[1]), Number(match[2]), Number(match[3])));
}

function palette(background: Color, text: Color, mode: TerminalColorMode): Theme {
  return { colors: { customMessageBg: background, customMessageText: text }, getColorMode: () => mode } as Theme;
}

for (const name of ["dark", "light"]) {
  for (const mode of ["truecolor", "256color"] as const) {
    test(`${name} ${mode}: all theme foregrounds meet 4.5:1 against the message background`, () => {
      const themePath = new URL(`../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/${name}.json`, import.meta.url);
      const theme = JSON.parse(readFileSync(themePath, "utf8")) as { vars: Record<string, string>; colors: Record<string, string> };
      const resolve = (value: string): Color => parseColor(theme.vars[value] ?? value);
      const background = resolve(theme.colors.customMessageBg!);
      const emittedBackground = emittedColors(foregroundAnsi(background, mode))[0]!;
      const format = messageForeground(palette(background, resolve(theme.colors.customMessageText!), mode));
      for (const [token, value] of Object.entries(theme.colors)) {
        if (token.endsWith("Bg")) continue;
        const rendered = format(foregroundAnsi(resolve(value), mode) + "Readable text\x1b[39m");
        assert.equal(stripVTControlCharacters(rendered), "Readable text");
        for (const color of emittedColors(rendered)) {
          assert.ok(contrastRatio(color, emittedBackground) >= 4.5, `${token}: ${contrastRatio(color, emittedBackground)}`);
        }
      }
    });
  }
}

test("preserves already readable hues and corrects defaults, resets, faint and basic ANSI colors", () => {
  const background = rgbColor(40, 15, 50);
  const foreground = rgbColor(240, 180, 80);
  const format = messageForeground(palette(background, rgbColor(45, 20, 55), "truecolor"));
  const readable = foregroundAnsi(foreground, "truecolor");
  assert.ok(format(readable + "gold").includes(readable));
  const rendered = format("Plain\x1b[0m reset\x1b[2m faint\x1b[31m red\x1b[39m default");
  assert.equal(stripVTControlCharacters(rendered), "Plain reset faint red default");
  assert.ok(!rendered.includes("\x1b[2m"));
  for (const color of emittedColors(rendered)) assert.ok(contrastRatio(color, background) >= 4.5);
});

for (const mode of ["truecolor", "256color"] as const) {
  test(`${mode}: handles a custom mid-gray background and identical foreground`, () => {
    const background = rgbColor(125, 125, 125);
    const format = messageForeground(palette(background, background, mode));
    const emittedBackground = emittedColors(foregroundAnsi(background, mode))[0]!;
    for (const color of emittedColors(format(foregroundAnsi(background, mode) + "text"))) {
      assert.ok(contrastRatio(color, emittedBackground) >= 4.5);
    }
  });
}
