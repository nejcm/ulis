import { join } from "node:path";

import { isSamePath, PLATFORM_DIRS, platformConfigDir, resolvePlatformDirSegment } from "../platforms.js";
import type { PreservedNativeConfigSpec } from "./preserved-native-configs.js";

export const PRESERVED_NATIVE_CONFIGS = [
  {
    platform: "opencode",
    label: "opencode.json",
    names: ["opencode.json"],
    generatedPath: (context) => join(context.outputDir, "opencode", "opencode.json"),
    targetPath: (context) => join(platformConfigDir("opencode", context.destBase, context.userHome), "opencode.json"),
    preservedPaths: [["mcp"]],
  },
  {
    platform: "claude",
    label: "settings.json",
    names: ["settings.json"],
    generatedPath: (context) => join(context.outputDir, "claude", "settings.json"),
    targetPath: (context) => join(platformConfigDir("claude", context.destBase, context.userHome), "settings.json"),
    preservedPaths: [
      ["hooks"],
      ["statusLine"],
      ["enabledPlugins"],
      ["extraKnownMarketplaces"],
      ["autoUpdatesChannel"],
      ["agentPushNotifEnabled"],
      ["theme"],
    ],
    overlay: "json",
  },
  {
    platform: "claude",
    // Machine-local overrides Claude Code owns. ULIS only contributes what a raw
    // fragment provides, so the existing file is the base and generated values
    // overlay on top; with no generated file the user's file is left untouched.
    label: "settings.local.json",
    names: ["settings.local.json"],
    generatedPath: (context) => join(context.outputDir, "claude", "settings.local.json"),
    targetPath: (context) =>
      join(platformConfigDir("claude", context.destBase, context.userHome), "settings.local.json"),
    preservedPaths: [[]],
    overlay: "json",
  },
  {
    platform: "claude",
    label: ".claude.json / .mcp.json",
    names: [".claude.json", ".mcp.json"],
    generatedPath: (context) => join(context.outputDir, "claude", ".claude.json"),
    // Claude Code reads MCP servers from two different files depending on scope:
    // - Global install (~): user-scope `~/.claude.json` (huge file Claude Code owns —
    //   `projects`, `enabledPlugins`, history, theme, telemetry, ... — ULIS only
    //   contributes `mcpServers`).
    // - Project install (<cwd>): project-scope `<cwd>/.mcp.json` (committed, just `{ mcpServers }`).
    // The generated `.claude.json` content (`{ mcpServers: {...} }`) fits both formats.
    // Merge behavior differs by mode:
    // - Global (~/.claude.json): overlay generated MCP values onto the complete
    //   existing file, preserving all absent keys and unmanaged MCP servers.
    // - Project (<cwd>/.mcp.json): "file" — the file is just `{ mcpServers }`,
    //   retaining the existing selective merge behavior.
    targetPath: (context) =>
      isSamePath(context.destBase, context.userHome)
        ? join(context.destBase, ".claude.json")
        : join(context.destBase, ".mcp.json"),
    preservedPaths: [["mcpServers"]],
    ownership: (context) => (isSamePath(context.destBase, context.userHome) ? "paths" : "file"),
    overlay: (context) => (isSamePath(context.destBase, context.userHome) ? "json" : undefined),
  },
  {
    platform: "codex",
    label: "config.toml",
    names: ["config.toml"],
    generatedPath: (context) => join(context.outputDir, "codex", "config.toml"),
    targetPath: (context) => join(platformConfigDir("codex", context.destBase, context.userHome), "config.toml"),
    preservedPaths: [["projects"], ["hooks"], ["mcp_servers"], ["tui"], ["notice"], ["features"]],
    overlay: "toml",
  },
  {
    platform: "cursor",
    label: "mcp.json",
    names: ["mcp.json"],
    generatedPath: (context) => join(context.outputDir, "cursor", "mcp.json"),
    targetPath: (context) => join(platformConfigDir("cursor", context.destBase, context.userHome), "mcp.json"),
    preservedPaths: [["mcpServers"]],
  },
  {
    platform: "forgecode",
    label: ".mcp.json",
    names: [".mcp.json"],
    generatedPath: (context) =>
      join(context.outputDir, "forgecode", resolvePlatformDirSegment(PLATFORM_DIRS.forgecode.project), ".mcp.json"),
    targetPath: (context) => join(platformConfigDir("forgecode", context.destBase, context.userHome), ".mcp.json"),
    preservedPaths: [["mcpServers"]],
  },
  {
    platform: "forgecode",
    label: ".forge.toml",
    names: [".forge.toml"],
    generatedPath: (context) => join(context.outputDir, "forgecode", ".forge.toml"),
    targetPath: (context) => join(platformConfigDir("forgecode", context.destBase, context.userHome), ".forge.toml"),
    preservedPaths: [[]],
  },
] as const satisfies readonly PreservedNativeConfigSpec[];
