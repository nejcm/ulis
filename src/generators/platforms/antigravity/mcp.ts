import type { McpConfig, McpServer } from "../../../schema.js";
import { translateEnvVar } from "../../../utils/env-var.js";
import { mcpServerEnabled, mcpServersFor, translateEnvMap } from "../../../utils/mcp-block.js";
import type { FileArtifact } from "../../types.js";

function antigravityMcpServer(server: McpServer): Record<string, unknown> | undefined {
  const entry: Record<string, unknown> = {};
  if (server.type === "remote" && server.url) {
    entry.serverUrl = translateEnvVar(server.url, "antigravity");
    const headers = translateEnvMap(server.headers, "antigravity");
    if (headers) entry.headers = headers;
  } else if (server.type === "local") {
    if (server.command) entry.command = translateEnvVar(server.command, "antigravity");
    if (server.args) entry.args = server.args.map((arg) => translateEnvVar(arg, "antigravity"));
    const env = translateEnvMap(server.env, "antigravity");
    if (env) entry.env = env;
  } else {
    return undefined;
  }
  if (mcpServerEnabled(server) === false) entry.disabled = true;
  return entry;
}

export function buildAntigravityMcpArtifact(mcp: McpConfig): FileArtifact {
  const mcpServers: Record<string, unknown> = {};
  for (const [name, server] of mcpServersFor(mcp, "antigravity")) {
    const entry = antigravityMcpServer(server);
    if (entry) mcpServers[name] = entry;
  }
  return { path: "mcp_config.json", contents: JSON.stringify({ mcpServers }, null, 2) };
}
