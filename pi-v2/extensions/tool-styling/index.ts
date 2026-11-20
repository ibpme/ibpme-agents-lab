import type { ExtensionAPI, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { withSshDestination } from "../shared/ssh-destination.ts";
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
  const styledRenderers = new Map(Array.from(renderers, ([name, renderer]) => {
    const styled = { ...renderer, renderResult: withSshDestination(renderer.renderResult) };
    return [name, styled] as const;
  }));
  pi.registerToolRenderer((name, next) => styledRenderers.get(name.replace(/_remote$/, "")) ?? next());
}
