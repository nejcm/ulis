import type { ToolPermissions } from "../schema.js";

export type ToolPlatform = "claude" | "cursor" | "opencode" | "codex" | "forgecode";

// mapping agent tool permissions to tool names for each platform
const PLATFORM_TOOL_NAMES: Record<
  Exclude<ToolPlatform, "opencode" | "codex">,
  {
    readonly read: readonly string[];
    readonly write: readonly string[];
    readonly edit: readonly string[];
    readonly bash: readonly string[];
    readonly search: readonly string[];
    readonly browser: readonly string[];
  }
> = {
  claude: {
    read: ["Read", "Glob", "Grep"],
    write: ["Write"],
    edit: ["Edit"],
    bash: ["Bash"],
    search: ["WebSearch", "WebFetch"],
    browser: ["mcp__playwright__navigate", "mcp__playwright__screenshot"],
  },
  cursor: {
    read: ["read_file", "list_directory", "search_files"],
    write: ["write_file"],
    edit: ["edit_file"],
    bash: ["run_terminal_command"],
    search: ["web_search"],
    browser: ["browser_action"],
  },
  forgecode: {
    read: ["read"],
    write: ["write"],
    edit: ["patch"],
    bash: ["shell"],
    search: ["search", "fetch"],
    browser: ["mcp_*"],
  },
};

/**
 * Map canonical `ToolPermissions` to a flat list of platform-specific tool
 * names. Returns an empty array for platforms that do not consume a tool list
 * (currently `opencode` and `codex` — they read the structured `tools` object
 * directly from the agent block / TOML).
 *
 * Subagent allowlist (`tools.agent`) is appended for `claude` only — it is
 * the only platform that supports `Agent(name1, name2)` in `allowed-tools`.
 *
 * Tool name maps are internal ULIS defaults and not user-configurable.
 */
export function mapTools(perms: ToolPermissions, platform: ToolPlatform): string[] {
  if (typeof perms === "string") return perms.split(",").map((t) => t.trim());

  if (platform === "opencode" || platform === "codex") {
    // These platforms consume the structured `ToolPermissions` directly;
    // no flat tool name list is needed.
    return [];
  }

  const names = PLATFORM_TOOL_NAMES[platform];
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
