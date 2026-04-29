import { mcpServersFor, translateEnvMap } from "../../../utils/mcp-block.js";
import type { FileArtifact, ProjectBundle } from "../../types.js";

export function buildCursorConfigArtifacts(project: ProjectBundle): FileArtifact[] {
  const artifacts: FileArtifact[] = [];

  const mcpServers: Record<string, unknown> = {};
  for (const [name, server] of mcpServersFor(project.mcp, "cursor")) {
    if (server.type === "remote" && server.url) {
      const entry: Record<string, unknown> = { url: server.url };
      const headers = translateEnvMap(server.headers, "cursor");
      if (headers) entry.headers = headers;
      mcpServers[name] = entry;
    } else if (server.type === "local") {
      const entry: Record<string, unknown> = {};
      if (server.command) entry.command = server.command;
      if (server.args) entry.args = server.args;
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
