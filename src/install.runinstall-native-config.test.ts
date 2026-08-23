// runInstall: cross-platform preserved-native-config contract (Claude, Cursor, ForgeCode, OpenCode)
// and its missing/invalid-file edge cases - absent generated config, a mid-install copy failure, and
// a backup-before-parse-failure. "leaves existing Codex config unchanged when generated config is
// absent" lives here (not with the Codex TOML-merge tests) because it is part of this same
// generated-config-absent contract, mirroring the neighboring OpenCode absent-config tests.
import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { type Logger } from "./build.js";
import { __test, runInstall } from "./install.js";
import { cleanupInstallTempRoots, createTempRoot, read, silentLogger, write } from "./test-utils/install.js";
import { readMergeableConfig } from "./utils/config-merge.js";

afterEach(() => {
  __test.resetRuntimeDependencies();
  cleanupInstallTempRoots();
});

describe("runInstall", () => {
  it("preserves native config across platform installs", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    write(
      join(outputDir, "claude", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(git status)"] } }, null, 2),
    );
    write(
      join(outputDir, "claude", ".claude.json"),
      JSON.stringify({ mcpServers: { shared: { command: "generated" } } }, null, 2),
    );
    write(
      join(outputDir, "cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { shared: { command: "generated" } } }, null, 2),
    );
    write(
      join(outputDir, "forgecode", ".forge", ".mcp.json"),
      JSON.stringify({ mcpServers: { shared: { command: "generated" } } }, null, 2),
    );
    write(
      join(outputDir, "forgecode", ".forge.toml"),
      ["max_conversations = 200", "", "[updates]", "enabled = false"].join("\n"),
    );
    write(
      join(outputDir, "opencode", "opencode.json"),
      JSON.stringify({ model: "generated", mcp: { shared: { command: ["generated"] } } }, null, 2),
    );
    write(
      join(projectDir, ".claude", "settings.json"),
      JSON.stringify(
        {
          env: { OLD: "1" },
          hooks: { PreToolUse: [{ matcher: "existing" }] },
          statusLine: { type: "command", command: "bash ~/.claude/statusline.sh" },
          enabledPlugins: { "plugin@example": true },
          extraKnownMarketplaces: { example: { source: { source: "github", repo: "owner/repo" } } },
          autoUpdatesChannel: "latest",
          agentPushNotifEnabled: true,
          theme: "dark",
          mcpServers: { old: { command: "old" } },
        },
        null,
        2,
      ),
    );
    write(
      join(projectDir, ".mcp.json"),
      JSON.stringify(
        { other: true, mcpServers: { existing: { command: "old" }, shared: { command: "old" } } },
        null,
        2,
      ),
    );
    write(
      join(projectDir, ".cursor", "mcp.json"),
      JSON.stringify(
        { other: true, mcpServers: { existing: { command: "old" }, shared: { command: "old" } } },
        null,
        2,
      ),
    );
    write(
      join(projectDir, ".forge", ".mcp.json"),
      JSON.stringify(
        { other: true, mcpServers: { existing: { command: "old" }, shared: { command: "old" } } },
        null,
        2,
      ),
    );
    write(
      join(projectDir, ".forge", ".forge.toml"),
      ["max_conversations = 100", "", "[updates]", 'channel = "stable"'].join("\n"),
    );
    write(
      join(projectDir, ".opencode", "opencode.json"),
      JSON.stringify({ model: "old", mcp: { existing: { command: ["old"] }, shared: { command: ["old"] } } }, null, 2),
    );

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["claude", "cursor", "forgecode", "opencode"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(JSON.parse(read(join(projectDir, ".claude", "settings.json")))).toEqual({
      env: { OLD: "1" },
      hooks: { PreToolUse: [{ matcher: "existing" }] },
      mcpServers: { old: { command: "old" } },
      statusLine: { type: "command", command: "bash ~/.claude/statusline.sh" },
      enabledPlugins: { "plugin@example": true },
      extraKnownMarketplaces: { example: { source: { source: "github", repo: "owner/repo" } } },
      autoUpdatesChannel: "latest",
      agentPushNotifEnabled: true,
      theme: "dark",
      permissions: { allow: ["Bash(git status)"] },
    });
    expect(JSON.parse(read(join(projectDir, ".mcp.json")))).toEqual({
      mcpServers: { existing: { command: "old" }, shared: { command: "generated" } },
    });
    expect(JSON.parse(read(join(projectDir, ".cursor", "mcp.json")))).toEqual({
      mcpServers: { existing: { command: "old" }, shared: { command: "generated" } },
    });
    expect(JSON.parse(read(join(projectDir, ".forge", ".mcp.json")))).toEqual({
      mcpServers: { existing: { command: "old" }, shared: { command: "generated" } },
    });
    expect(readMergeableConfig(join(projectDir, ".forge", ".forge.toml"))).toEqual({
      max_conversations: 200,
      updates: { channel: "stable", enabled: false },
    });
    expect(JSON.parse(read(join(projectDir, ".opencode", "opencode.json")))).toEqual({
      model: "generated",
      mcp: { existing: { command: ["old"] }, shared: { command: ["generated"] } },
    });
  });

  it("merges Claude settings.local.json with the existing file", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    write(join(outputDir, "claude", "settings.json"), "{}");
    write(
      join(outputDir, "claude", "settings.local.json"),
      JSON.stringify({ permissions: { allow: ["Bash(ls:*)"] } }, null, 2),
    );
    write(
      join(projectDir, ".claude", "settings.local.json"),
      JSON.stringify({ existingLocalKey: true, permissions: { deny: ["Bash(rm:*)"] } }, null, 2),
    );

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["claude"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(JSON.parse(read(join(projectDir, ".claude", "settings.local.json")))).toEqual({
      existingLocalKey: true,
      permissions: { deny: ["Bash(rm:*)"], allow: ["Bash(ls:*)"] },
    });
  });

  it("leaves an existing Claude settings.local.json untouched when nothing is generated", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    write(join(outputDir, "claude", "settings.json"), "{}");
    write(join(projectDir, ".claude", "settings.local.json"), JSON.stringify({ keepMe: true }, null, 2));

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["claude"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(JSON.parse(read(join(projectDir, ".claude", "settings.local.json")))).toEqual({ keepMe: true });
  });

  it("preserves OpenCode allowlisted config when generated config is absent", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    write(join(outputDir, "opencode", "AGENTS.md"), "Generated instructions.\n");
    write(
      join(projectDir, ".opencode", "opencode.json"),
      JSON.stringify({ model: "old", mcp: { existing: { command: ["old"] } } }, null, 2),
    );

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["opencode"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(read(join(projectDir, ".opencode", "AGENTS.md"))).toBe("Generated instructions.\n");
    expect(JSON.parse(read(join(projectDir, ".opencode", "opencode.json")))).toEqual({
      mcp: { existing: { command: ["old"] } },
    });
  });

  it("keeps preserved OpenCode MCP servers when the later platform copy fails", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const generatedDir = join(outputDir, "opencode");
    const targetConfig = join(projectDir, ".opencode", "opencode.json");
    write(join(generatedDir, "opencode.json"), JSON.stringify({ mcp: {} }));
    write(join(generatedDir, "AGENTS.md"), "Generated instructions.\n");
    write(targetConfig, JSON.stringify({ mcp: { existing: { command: ["old"] } } }));
    mkdirSync(userHome, { recursive: true });
    const logger: Logger = {
      ...silentLogger,
      success(message) {
        if (message.startsWith("opencode.json")) rmSync(generatedDir, { recursive: true });
      },
    };

    await expect(
      runInstall({
        sourceDir,
        outputDir,
        destBase: projectDir,
        userHome,
        platforms: ["opencode"],
        rebuild: false,
        logger,
      }),
    ).rejects.toThrow("Generated platform directory does not exist");

    expect(JSON.parse(read(targetConfig)).mcp).toEqual({ existing: { command: ["old"] } });
  });

  it("drops existing native config when generated config is absent and no allowlisted keys exist", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    write(join(outputDir, "opencode", "AGENTS.md"), "Generated instructions.\n");
    write(join(projectDir, ".opencode", "opencode.json"), JSON.stringify({ model: "old" }, null, 2));

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["opencode"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(read(join(projectDir, ".opencode", "AGENTS.md"))).toBe("Generated instructions.\n");
    expect(existsSync(join(projectDir, ".opencode", "opencode.json"))).toBe(false);
  });

  it("leaves existing Codex config unchanged when generated config is absent", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    write(join(outputDir, "codex", "AGENTS.md"), "Generated instructions.\n");
    write(join(projectDir, ".codex", "config.toml"), 'model = "old"\n');

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["codex"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(read(join(projectDir, ".codex", "AGENTS.md"))).toBe("Generated instructions.\n");
    expect(read(join(projectDir, ".codex", "config.toml"))).toBe('model = "old"\n');
  });

  it("backs up existing config before failing to parse preserved native config", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    write(join(outputDir, "codex", "config.toml"), 'approval_policy = "never"\n');
    write(join(projectDir, ".codex", "config.toml"), "[invalid\n");

    await expect(
      runInstall({
        sourceDir,
        outputDir,
        destBase: projectDir,
        userHome,
        platforms: ["codex"],
        rebuild: false,
        backup: true,
        logger: silentLogger,
      }),
    ).rejects.toThrow("Failed to parse existing native config");

    expect(readdirSync(projectDir).some((entry) => entry.startsWith(".codex.") && entry.endsWith(".backup"))).toBe(
      true,
    );
  });
});
