import { join } from "node:path";

import { mcpServersFor, translateEnvMap } from "../../../utils/mcp-block.js";
import type { FileArtifact, ProjectBundle } from "../../types.js";

export function buildForgecodeMcpArtifact(mcp: ProjectBundle["mcp"]): FileArtifact {
  const mcpServers: Record<string, Record<string, unknown>> = {};
  for (const [name, server] of mcpServersFor(mcp, "forgecode")) {
    if (server.type === "local") {
      const entry: Record<string, unknown> = {};
      if (server.command) entry.command = server.command;
      if (server.args) entry.args = server.args;
      const env = translateEnvMap(server.env, "forgecode");
      if (env) entry.env = env;
      if (server.enabled === false) entry.disable = true;
      mcpServers[name] = entry;
      continue;
    }
    if (!server.url) continue;
    const transportType = server.transport ?? "http";
    const entry: Record<string, unknown> = { type: transportType, url: server.url };
    const headers = translateEnvMap(server.headers, "forgecode");
    if (headers) entry.headers = headers;
    if (server.enabled === false) entry.disable = true;
    mcpServers[name] = entry;
  }
  return { path: join(".forge", ".mcp.json"), contents: JSON.stringify({ mcpServers }, null, 2) };
}
