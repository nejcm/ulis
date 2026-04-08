import type { BuildConfig } from "../config.js";
import type { ToolPermissions } from "../schema.js";

export type ToolPlatform = "claude" | "cursor" | "opencode" | "codex";

/**
 * Map canonical `ToolPermissions` to a flat list of platform-specific tool
 * names. Returns an empty array for platforms that do not consume a tool list
 * (currently `opencode` and `codex` — they read the structured `tools` object
 * directly from the agent block / TOML).
 *
 * Subagent allowlist (`tools.agent`) is appended for `claude` only — it is
 * the only platform that supports `Agent(name1, name2)` in `allowed-tools`.
 *
 * Tool name maps come from `BuildConfig.platforms.<tool>.toolNames`, so users
 * can rename a tool through `.ai/build.config.json` without code changes.
 */
export function mapTools(perms: ToolPermissions, platform: ToolPlatform, cfg: BuildConfig): string[] {
  if (platform === "opencode" || platform === "codex") {
    // These platforms consume the structured `ToolPermissions` directly;
    // no flat tool name list is needed.
    return [];
  }

  const names = cfg.platforms[platform].toolNames;
  const tools: string[] = [];

  if (perms.read) tools.push(...names.read);
  if (perms.write) tools.push(...names.write);
  if (perms.edit) tools.push(...names.edit);
  if (perms.bash) tools.push(...names.bash);
  if (perms.search) tools.push(...names.search);
  if (perms.browser) tools.push(...names.browser);

  // Subagent spawning: only Claude supports the `Agent(name, ...)` syntax.
  if (platform === "claude") {
    if (perms.agent === true) {
      tools.push("Agent");
    } else if (Array.isArray(perms.agent)) {
      tools.push(`Agent(${perms.agent.join(", ")})`);
    }
  }

  return tools;
}
