import type { ExtensionAPI, ToolRenderers } from "@earendil-works/pi-coding-agent";
import {
  bashRenderer,
  editRenderer,
  findRenderer,
  grepRenderer,
  lsRenderer,
  readRenderer,
  writeRenderer,
} from "./renderers.ts";

const renderers = new Map<string, ToolRenderers>([
  ["read", readRenderer],
  ["write", writeRenderer],
  ["edit", editRenderer],
  ["bash", bashRenderer],
  ["grep", grepRenderer],
  ["find", findRenderer],
  ["ls", lsRenderer],
]);

export default function toolStyling(pi: ExtensionAPI): void {
  pi.registerToolRenderer((name, next) => renderers.get(name) ?? next());
}
