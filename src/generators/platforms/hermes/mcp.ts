import { stringify as stringifyYaml } from "yaml";

import type { McpConfig, McpServer } from "../../../schema.js";
import { translateEnvVar } from "../../../utils/env-var.js";
import { mcpServerEnabled, mcpServersFor, translateEnvMap } from "../../../utils/mcp-block.js";
import type { FileArtifact } from "../../types.js";

function hermesMcpServer(server: McpServer): Record<string, unknown> | undefined {
  const entry: Record<string, unknown> = {};
  if (server.type === "remote" && server.url) {
    entry.url = translateEnvVar(server.url, "hermes");
    const headers = translateEnvMap(server.headers, "hermes");
    if (headers) entry.headers = headers;
    if (server.transport === "sse") entry.transport = "sse";
  } else if (server.type === "local") {
    if (server.command) entry.command = translateEnvVar(server.command, "hermes");
    if (server.args) entry.args = server.args.map((arg) => translateEnvVar(arg, "hermes"));
    const env = translateEnvMap(server.env, "hermes");
    if (env) entry.env = env;
  } else {
    return undefined;
  }
  if (mcpServerEnabled(server) === false) entry.enabled = false;
  return entry;
}

export function buildHermesMcpArtifact(mcp: McpConfig): FileArtifact {
  const mcp_servers: Record<string, unknown> = {};
  for (const [name, server] of mcpServersFor(mcp, "hermes")) {
    const entry = hermesMcpServer(server);
    if (entry) mcp_servers[name] = entry;
  }
  return { path: "config.yaml", contents: stringifyYaml({ mcp_servers }) };
}
