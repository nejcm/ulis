import { Platform } from "../platforms.js";
import type { McpConfig, McpServer } from "../schema.js";
import { translateEnvVar } from "./env-var.js";
import { checkPlatform } from "./platform.js";

type EnvTarget = Parameters<typeof translateEnvVar>[1];

/**
 * Iterate the MCP servers that target the given platform. Centralizes the
 * `targets` filter that every generator otherwise repeats.
 *
 * Semantics: an undefined `targets` field applies the server to every
 * platform. An empty array disables the server (no targets).
 */
export function* mcpServersFor(mcp: McpConfig, target: string): Generator<readonly [string, McpServer]> {
  for (const [name, server] of Object.entries(mcp.servers)) {
    if (server.targets !== undefined && !server.targets.includes(target)) continue;
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

/**
 * Normalize local MCP command execution for platform quirks.
 * Claude Code on Windows requires invoking npx via `cmd /c`.
 */
export function normalizeLocalMcpCommand(
  server: Pick<McpServer, "command" | "args">,
  target: Platform,
  platform: NodeJS.Platform = process.platform,
): { command?: string; args?: string[] } {
  const command = server.command;
  const args = server.args ? [...server.args] : undefined;
  if (!command) return { command, args };
  const which = checkPlatform(platform);

  const isWindowsClaude = which.windows && target === "claude";
  const isNpxCommand = /(^|[\\/])npx(?:\.cmd)?$/i.test(command);

  if (isWindowsClaude && isNpxCommand) {
    return {
      command: "cmd",
      args: ["/c", command, ...(args ?? [])],
    };
  }

  return { command, args };
}
