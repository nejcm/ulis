import type { McpConfig, McpServer } from "../../../schema.js";
import { translateEnvVar } from "../../../utils/env-var.js";
import { mcpServerEnabled, mcpServersFor, translateEnvMap } from "../../../utils/mcp-block.js";
import type { FileArtifact } from "../../types.js";

function devinMcpServer(server: McpServer): Record<string, unknown> | undefined {
  const entry: Record<string, unknown> = {};
  if (server.type === "remote" && server.url?.trim()) {
    entry.url = translateEnvVar(server.url, "devin");
    entry.transport = server.transport ?? "http";
    const headers = translateEnvMap(server.headers, "devin");
    if (headers) entry.headers = headers;
  } else if (server.type === "local" && server.command?.trim()) {
    entry.command = translateEnvVar(server.command, "devin");
    if (server.args) entry.args = server.args.map((arg) => translateEnvVar(arg, "devin"));
    const env = translateEnvMap(server.env, "devin");
    if (env) entry.env = env;
  } else {
    return undefined;
  }
  if (mcpServerEnabled(server) === false) entry.disabled = true;
  return entry;
}

export function buildDevinMcpArtifact(mcp: McpConfig): FileArtifact {
  const mcpServers: Record<string, unknown> = {};
  for (const [name, server] of mcpServersFor(mcp, "devin")) {
    const entry = devinMcpServer(server);
    if (entry) mcpServers[name] = entry;
  }
  return { path: "mcp_config.json", contents: JSON.stringify({ mcpServers }, null, 2) };
}
