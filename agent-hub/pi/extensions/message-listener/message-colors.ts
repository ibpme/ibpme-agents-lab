import type { Theme } from "@earendil-works/pi-coding-agent";
import { colorToRgb, foregroundAnsi, indexedColor, mixColors, rgbColor } from "@earendil-works/pi-tui";
import type { Color, TerminalColorMode } from "@earendil-works/pi-tui";

function luminance(color: Color): number {
  const { r, g, b } = colorToRgb(color);
  const linear = [r, g, b].map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

export function contrastRatio(first: Color, second: Color): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function emittedColor(color: Color, mode: TerminalColorMode): Color {
  if (mode === "truecolor") {
    const { r, g, b } = colorToRgb(color);
    return rgbColor(Math.round(r), Math.round(g), Math.round(b));
  }
  const index = /\x1b\[38;5;(\d+)m/.exec(foregroundAnsi(color, mode));
  return index ? indexedColor(Number(index[1])) : color;
}

function readableColor(color: Color, background: Color, mode: TerminalColorMode): Color {
  if (contrastRatio(emittedColor(color, mode), background) >= 4.5) return color;
  const black = rgbColor(0, 0, 0);
  const white = rgbColor(255, 255, 255);
  const target = contrastRatio(black, background) > contrastRatio(white, background) ? black : white;
  for (let step = 1; step <= 40; step++) {
    const candidate = mixColors(color, target, step / 40, "srgb");
    if (contrastRatio(emittedColor(candidate, mode), background) >= 4.5) return candidate;
  }
  return target;
}

// Apply after Markdown rendering so syntax highlighting and nested ANSI resets
// cannot reintroduce low-contrast colors or terminal-default text on the card.
export function messageForeground(theme: Theme): (text: string) => string {
  const mode = theme.getColorMode();
  const background = emittedColor(theme.colors.customMessageBg, mode);
  const defaultColor = foregroundAnsi(readableColor(theme.colors.customMessageText, background, mode), mode);
  const cache = new Map<string, string>();
  return text => {
    const colored = text.replace(/\x1b\[(38;2;(\d+);(\d+);(\d+)|38;5;(\d+)|3[0-7]|9[0-7]|39|0|2)m/g,
      (sequence: string, code: string, r: string, g: string, b: string, index: string) => {
        if (code === "39") return defaultColor;
        if (code === "0") return sequence + defaultColor;
        if (code === "2") return "";
        const cached = cache.get(sequence);
        if (cached) return cached;
        const color = r !== undefined ? rgbColor(Number(r), Number(g), Number(b))
          : index !== undefined ? indexedColor(Number(index))
          : indexedColor(Number(code) >= 90 ? Number(code) - 90 + 8 : Number(code) - 30);
        const result = foregroundAnsi(readableColor(color, background, mode), mode);
        cache.set(sequence, result);
        return result;
      });
    return defaultColor + colored + "\x1b[39m";
  };
}
