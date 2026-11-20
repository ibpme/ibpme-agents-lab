import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isDefaultSegment, type DefaultSegment } from "./default-segments/index.ts";

export interface StatusRow {
  left: string[];
  right: string[];
  separator: string;
  rightSeparator?: string;
}

export interface StatusLayout {
  footer: StatusRow[];
  hidden: string[];
}

export const defaultLayout: StatusLayout = {
  footer: [
    { left: ["cwd", "git", "status:ssh", "session"], right: ["status:prompt-suggestions"], separator: " " },
    {
      left: ["status:mode", "status:codemode", "tokens", "status:agent-stats", "cost", "status:reasoning-tokens"],
      right: ["model", "thinking", "status:openai-fast"], separator: " · ", rightSeparator: " • ",
    },
    { left: ["status:tools", "status:loaded-skills", "status:mcp-tools", "status:*"], right: [], separator: " · " },
  ],
  hidden: [],
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim().length > 0)) {
    throw new Error(`${name} must be an array of nonempty strings`);
  }
  return value;
}

function separator(value: unknown): string {
  if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error("Row separator must be a single-line string without control characters");
  }
  return value;
}

export function parseLayout(value: unknown): StatusLayout {
  if (!object(value)) throw new Error("Layout must be an object");
  for (const key of Object.keys(value)) {
    // Empty legacy editor regions are harmless; rich-widget layout is deferred.
    if ((key === "aboveEditor" || key === "belowEditor") && Array.isArray(value[key]) && value[key].length === 0) continue;
    if (!["footer", "hidden"].includes(key)) throw new Error(`Unsupported layout option: ${key}`);
  }
  const rows = value.footer === undefined ? defaultLayout.footer : value.footer;
  if (!Array.isArray(rows)) throw new Error("footer must be an array of rows");
  const selectors = new Set<string>();
  const footer = rows.map((row, index): StatusRow => {
    if (!object(row)) throw new Error(`footer[${index}] must be an object`);
    for (const key of Object.keys(row)) {
      if (!["left", "right", "separator", "rightSeparator"].includes(key)) throw new Error(`Unknown row option: ${key}`);
    }
    const left = strings(row.left === undefined ? [] : row.left, `footer[${index}].left`);
    const right = strings(row.right === undefined ? [] : row.right, `footer[${index}].right`);
    for (const name of [...left, ...right]) {
      if (!isDefaultSegment(name) && !/^status:[^\s\x00-\x1f\x7f]+$/.test(name)) {
        throw new Error(`Unknown segment: ${name}`);
      }
      if (selectors.has(name)) throw new Error(`Duplicate segment: ${name}`);
      selectors.add(name);
    }
    return {
      left, right,
      separator: separator(row.separator === undefined ? " " : row.separator),
      ...(row.rightSeparator === undefined ? {} : { rightSeparator: separator(row.rightSeparator) }),
    };
  });
  const hidden = strings(value.hidden === undefined ? [] : value.hidden, "hidden");
  if (hidden.some((key) => /[\s\x00-\x1f\x7f]/.test(key) || key === "*")) throw new Error("Hidden statuses must be exact status keys");
  return { footer, hidden };
}

export function sanitizeStatus(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export function alignRow(left: string, right: string, width: number): string {
  width = Math.max(0, Math.floor(width));
  if (width === 0) return "";
  if (!right) return truncateToWidth(left, width, "...");
  if (!left || visibleWidth(right) >= width) {
    const clipped = truncateToWidth(right, width, "...");
    return " ".repeat(Math.max(0, width - visibleWidth(clipped))) + clipped;
  }
  const clipped = truncateToWidth(left, Math.max(0, width - visibleWidth(right) - 2), "...");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped) - visibleWidth(right))) + right;
}

export function renderLayout(
  layout: StatusLayout,
  statuses: ReadonlyMap<string, string>,
  renderSegment: (name: DefaultSegment) => string,
  width: number,
): string[] {
  const placed = new Set(layout.footer.flatMap((row) => [...row.left, ...row.right]));
  const hidden = new Set(layout.hidden);
  const remaining = [...statuses].sort(([a], [b]) => a.localeCompare(b))
    .filter(([key]) => !hidden.has(key) && !placed.has(`status:${key}`));
  const expand = (selectors: string[], separator: string): string => selectors.flatMap((selector) => {
    if (isDefaultSegment(selector)) return [renderSegment(selector)].filter(Boolean);
    const key = selector.slice("status:".length);
    if (key === "*") return remaining.map(([, text]) => sanitizeStatus(text)).filter(Boolean);
    const text = hidden.has(key) ? undefined : statuses.get(key);
    return text ? [sanitizeStatus(text)].filter(Boolean) : [];
  }).join(separator);
  return layout.footer.flatMap((row) => {
    const left = expand(row.left, row.separator);
    const right = expand(row.right, row.rightSeparator ?? row.separator);
    return left || right ? [alignRow(left, right, width)] : [];
  });
}
