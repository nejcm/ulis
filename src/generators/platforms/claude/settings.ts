import { mcpServersFor, normalizeLocalMcpCommand, translateEnvMap } from "../../../utils/mcp-block.js";
import type { FileArtifact, ProjectBundle } from "../../types.js";

function buildMcpBlock(mcp: ProjectBundle["mcp"]): Record<string, unknown> {
  const mcpServers: Record<string, unknown> = {};
  for (const [name, server] of mcpServersFor(mcp, "claude")) {
    if (server.type === "local") {
      const entry: Record<string, unknown> = {};
      const { command, args } = normalizeLocalMcpCommand(server, "claude");
      if (command) entry.command = command;
      if (args) entry.args = args;
      const env = translateEnvMap(server.env, "claude");
      if (env) entry.env = env;
      mcpServers[name] = entry;
    } else if (server.url) {
      const transportType = server.transport ?? "http";
      const entry: Record<string, unknown> = { type: transportType, url: server.url };
      const headers = translateEnvMap(server.headers, "claude");
      if (headers) entry.headers = headers;
      mcpServers[name] = entry;
    }
  }
  return mcpServers;
}

function buildSettings(permissions: ProjectBundle["permissions"]): Record<string, unknown> {
  const permissionsBlock: Record<string, unknown> = {};
  if (permissions?.claude) {
    const cp = permissions.claude;
    if (cp.defaultMode) permissionsBlock.defaultMode = cp.defaultMode;
    if (cp.allow?.length) permissionsBlock.allow = cp.allow;
    if (cp.deny?.length) permissionsBlock.deny = cp.deny;
    if (cp.ask?.length) permissionsBlock.ask = cp.ask;
    if (cp.additionalDirectories?.length) permissionsBlock.additionalDirectories = cp.additionalDirectories;
  }

  const settings: Record<string, unknown> = {};
  if (Object.keys(permissionsBlock).length > 0) {
    settings.permissions = permissionsBlock;
  }
  return settings;
}

export function buildClaudeSettingsArtifacts(project: ProjectBundle): FileArtifact[] {
  const artifacts: FileArtifact[] = [
    { path: "settings.json", contents: JSON.stringify(buildSettings(project.permissions), null, 2) },
  ];

  const mcpServers = buildMcpBlock(project.mcp);
  if (Object.keys(mcpServers).length > 0) {
    artifacts.push({ path: ".claude.json", contents: JSON.stringify({ mcpServers }, null, 2) });
  }

  return artifacts;
}
