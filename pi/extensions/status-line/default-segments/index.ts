import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import { locationSegments } from "./location.ts";
import { modelSegments } from "./model.ts";
import { usageSegments } from "./usage.ts";

export const defaultSegmentNames = ["cwd", "git", "session", "tokens", "cost", "model", "thinking"] as const;
export type DefaultSegment = typeof defaultSegmentNames[number];

export function isDefaultSegment(name: string): name is DefaultSegment {
  return defaultSegmentNames.some((segment) => segment === name);
}

export function createDefaultSegments(ctx: ExtensionContext, pi: ExtensionAPI, theme: Theme, data: ReadonlyFooterDataProvider) {
  const usage = usageSegments(ctx, theme);
  const segments = {
    ...locationSegments(ctx, theme, data),
    ...modelSegments(ctx, pi, theme),
    tokens: usage.tokens,
    cost: usage.cost,
  };
  return {
    render: (name: DefaultSegment): string => segments[name](),
    invalidate: usage.invalidate,
  };
}
