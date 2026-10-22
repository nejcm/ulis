import { withOrigin } from "../diagnostics.js";
import { enabledAgentsFor, type ParsedAgent } from "../parsers/agent.js";
import type { McpConfig } from "../schema.js";
import type { Diagnostic } from "../types.js";

const PLACEHOLDER = /\$\{(\w+)\}/g;

/** Antigravity writes `${VAR}` verbatim, so each placeholder bound for it gets a warning naming the variable only. */
export function validateMcpPlaceholders(mcp: McpConfig): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const [name, server] of Object.entries(mcp.servers)) {
    if (server.targets !== undefined && !server.targets.includes("antigravity")) continue;
    const fields: [string, string | undefined][] = [
      ["url", server.url],
      ["command", server.command],
      ...(server.args ?? []).map((arg, i): [string, string] => [`args[${i}]`, arg]),
      ...Object.entries(server.env ?? {}).map(([k, v]): [string, string] => [`env.${k}`, v]),
      ...Object.entries(server.headers ?? {}).map(([k, v]): [string, string] => [`headers.${k}`, v]),
    ];
    for (const [field, value] of fields) {
      for (const [, varName] of value?.matchAll(PLACEHOLDER) ?? []) {
        diags.push({
          level: "warning",
          entity: `mcp:${name}`,
          message: `Antigravity documents no \${VAR} interpolation; \${${varName}} is written verbatim to mcp_config.json`,
          suggestion: "set a literal value in raw/antigravity/mcp_config.json or drop antigravity from targets",
          fieldPath: `servers.${name}.${field}`,
          relativeFile: "mcp.yaml",
          target: "antigravity",
        });
      }
    }
  }
  return diags;
}

/** Antigravity types agent `mcpServers` as undocumented objects, so canonical references are not emitted. */
export function validateAntigravityAgentMcp(agents: readonly ParsedAgent[]): Diagnostic[] {
  return enabledAgentsFor(agents, "antigravity")
    .filter((agent) => agent.frontmatter.mcpServers?.length && !agent.frontmatter.platforms?.antigravity?.mcpServers)
    .map((agent) => ({
      level: "warning",
      entity: `agent:${agent.name}`,
      message: "Antigravity agent mcpServers entry format is undocumented; references not emitted",
      suggestion: "set platforms.antigravity.mcpServers with native objects",
      ...withOrigin(agent.origin, { fieldPath: "mcpServers[]", target: "antigravity" }),
    }));
}
