export type Mode = "yolo" | "safe";

/** Execution permissions, independent of tool registration and active declarations. */
export interface ToolSet {
  getMode(): Mode;
  setMode(next: Mode): void;
  toggleMode(): void;
  /** Extend SAFE's denied operations, e.g. SSH mutation tools. */
  addBlockedTools(names: readonly string[]): void;
  /** Checked for every direct and nested call, including inactive deferred tools. */
  isBlockedInSafe(name: string): boolean;
  /** Notified once per permission transition. */
  onChange(listener: () => void): () => void;
}
