import type { ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";

function sanitize(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export function locationSegments(ctx: ExtensionContext, theme: Theme, data: ReadonlyFooterDataProvider) {
  return {
    cwd(): string {
      let cwd = ctx.sessionManager.getCwd();
      const home = process.env.HOME || process.env.USERPROFILE;
      if (home && cwd === home) cwd = "~";
      else if (home && cwd.startsWith(`${home}/`)) cwd = `~${cwd.slice(home.length)}`;
      return theme.fg("accent", theme.bold(sanitize(cwd)));
    },
    git(): string {
      const branch = data.getGitBranch();
      return branch ? theme.fg("dim", "on ") + theme.fg("success", `⎇ ${sanitize(branch)}`) : "";
    },
    session(): string {
      const name = ctx.sessionManager.getSessionName();
      return name ? theme.fg("dim", "• ") + theme.fg("muted", sanitize(name)) : "";
    },
  };
}
