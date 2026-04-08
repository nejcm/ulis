import type { McpConfig, McpServer } from "../schema.js";
import { translateEnvVar } from "./env-var.js";

type EnvTarget = Parameters<typeof translateEnvVar>[1];

/**
 * Iterate the MCP servers that target the given platform. Centralizes the
 * `targets.includes(target)` filter that every generator otherwise repeats.
 */
export function* mcpServersFor(mcp: McpConfig, target: string): Generator<readonly [string, McpServer]> {
  for (const [name, server] of Object.entries(mcp.servers)) {
    if (!server.targets.includes(target)) continue;
    yield [name, server] as const;
  }
}

/**
 * Translate every value in a string-to-string map through `translateEnvVar`,
 * returning undefined if the input is undefined. Used by every generator to
 * rewrite `${VAR}` placeholders in env/header blocks for the target platform.
 */
export function translateEnvMap(
  map: Record<string, string> | undefined,
  target: EnvTarget,
): Record<string, string> | undefined {
  if (!map) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    out[k] = translateEnvVar(v, target);
  }
  return out;
}
