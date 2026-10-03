import { translateEnvVar } from "../../../utils/env-var.js";
import { mcpServerEnabled, mcpServersFor, translateEnvMap } from "../../../utils/mcp-block.js";
import type { FileArtifact, ProjectBundle } from "../../types.js";

export function buildCursorConfigArtifacts(project: ProjectBundle): FileArtifact[] {
  const artifacts: FileArtifact[] = [];

  const mcpServers: Record<string, unknown> = {};
  for (const [name, server] of mcpServersFor(project.mcp, "cursor")) {
    // mcp.json documents no on/off field, so a disabled server is left out.
    if (mcpServerEnabled(server) === false) continue;
    if (server.type === "remote" && server.url) {
      const entry: Record<string, unknown> = { url: translateEnvVar(server.url, "cursor") };
      const headers = translateEnvMap(server.headers, "cursor");
      if (headers) entry.headers = headers;
      mcpServers[name] = entry;
    } else if (server.type === "local") {
      const entry: Record<string, unknown> = {};
      if (server.command) entry.command = translateEnvVar(server.command, "cursor");
      if (server.args) entry.args = server.args.map((arg) => translateEnvVar(arg, "cursor"));
      const env = translateEnvMap(server.env, "cursor");
      if (env) entry.env = env;
      mcpServers[name] = entry;
    }
  }
  artifacts.push({ path: "mcp.json", contents: JSON.stringify({ mcpServers }, null, 2) });

  if (project.permissions?.cursor) {
    const cp = project.permissions.cursor;
    const cursorPerms: Record<string, unknown> = {};
    if (cp.mcpAllowlist?.length) cursorPerms.mcpAllowlist = cp.mcpAllowlist;
    if (cp.terminalAllowlist?.length) cursorPerms.terminalAllowlist = cp.terminalAllowlist;
    if (Object.keys(cursorPerms).length > 0) {
      artifacts.push({ path: "permissions.json", contents: JSON.stringify(cursorPerms, null, 2) });
    }
  }

  return artifacts;
}
