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

// runInstall: cross-platform native config merge and preservation (Codex, Claude, OpenCode, Cursor,
// ForgeCode) - also holds two installer-setup tests (Codex skill agent metadata, .env restore) that
// don't fit their own file.
describe("runInstall", () => {
  it("installs Codex skill agent metadata from source skill directories globally", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, "source");
    const openaiYaml = "interface:\n  display_name: Audit Skills\n";
    write(join(sourceDir, "config.yaml"), "version: 1\nname: test\n");
    write(
      join(sourceDir, "skills", "audit-skills", "SKILL.md"),
      "---\nname: audit-skills\ndescription: Audit skills\n---\nAudit skills.\n",
    );
    write(join(sourceDir, "skills", "audit-skills", "agents", "openai.yaml"), openaiYaml);

    await runInstall({
      sourceDir,
      destBase: root,
      userHome: root,
      globalInstall: true,
      platforms: ["codex"],
      rebuild: true,
      installExtensions: false,
      installSkills: false,
      logger: silentLogger,
    });

    expect(read(join(root, ".codex", "skills", "audit-skills", "agents", "openai.yaml"))).toBe(openaiYaml);
  });

  it("restores process.env after loading the source .env", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, "source");
    write(join(sourceDir, "config.yaml"), "version: 1\nname: test\n");
    write(join(sourceDir, ".env"), "ULIS_TEST_REMOTE_ENV=from-source\nULIS_TEST_PREEXISTING=overwritten\n");
    process.env.ULIS_TEST_PREEXISTING = "kept";

    try {
      await runInstall({
        sourceDir,
        destBase: root,
        userHome: root,
        globalInstall: true,
        platforms: ["codex"],
        rebuild: true,
        installExtensions: false,
        installSkills: false,
        logger: silentLogger,
      });

      expect(process.env.ULIS_TEST_REMOTE_ENV).toBeUndefined();
      expect(process.env.ULIS_TEST_PREEXISTING).toBe("kept");
    } finally {
      delete process.env.ULIS_TEST_PREEXISTING;
    }
  });

  it("overlays generated Codex values while preserving unmanaged config for project installs", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    write(
      join(outputDir, "codex", "config.toml"),
      [
        'approval_policy = "never"',
        'notice = "generated"',
        "",
        "[hooks]",
        'pre = ["raw"]',
        "",
        "[features]",
        "web_search = true",
        "",
        '[projects."/shared"]',
        'trust_level = "untrusted"',
        "",
        "[mcp_servers.shared]",
        'command = "new"',
        'args = ["generated"]',
        "",
        "[mcp_servers.generated]",
        'command = "node"',
      ].join("\n"),
    );
    write(
      join(projectDir, ".codex", "config.toml"),
      [
        'model = "old"',
        'notice = "existing"',
        "",
        "[hooks]",
        'pre = ["existing"]',
        "",
        "[features]",
        "web_search = false",
        "responses = true",
        "",
        "[tui]",
        'notifications = ["agent-turn-complete"]',
        "",
        '[projects."/keep"]',
        'trust_level = "trusted"',
        "",
        '[projects."/shared"]',
        'trust_level = "trusted"',
        "",
        "[mcp_servers.keep]",
        'command = "old"',
        "",
        "[mcp_servers.shared]",
        'command = "old"',
      ].join("\n"),
    );

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["codex"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(readMergeableConfig(join(projectDir, ".codex", "config.toml"))).toEqual({
      model: "old",
      approval_policy: "never",
      notice: "generated",
      hooks: { pre: ["raw"] },
      features: { web_search: true, responses: true },
      tui: { notifications: ["agent-turn-complete"] },
      projects: {
        "/keep": { trust_level: "trusted" },
        "/shared": { trust_level: "untrusted" },
      },
      mcp_servers: {
        keep: { command: "old" },
        shared: { command: "new", args: ["generated"] },
        generated: { command: "node" },
      },
    });
  });

  it("overlays generated Codex values while preserving unmanaged config for global installs", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    write(join(outputDir, "codex", "config.toml"), 'approval_policy = "on-request"\n');
    write(
      join(userHome, ".codex", "config.toml"),
      [
        'model = "old"',
        'notice = "existing"',
        "",
        "[features]",
        "responses = true",
        "",
        "[tui]",
        "show_raw_agent_reasoning = true",
        "",
        '[projects."/global"]',
        'trust_level = "trusted"',
      ].join("\n"),
    );

    await runInstall({
      sourceDir,
      outputDir,
      destBase: userHome,
      userHome,
      platforms: ["codex"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(readMergeableConfig(join(userHome, ".codex", "config.toml"))).toEqual({
      model: "old",
      approval_policy: "on-request",
      notice: "existing",
      features: { responses: true },
      tui: { show_raw_agent_reasoning: true },
      projects: { "/global": { trust_level: "trusted" } },
    });
  });

  it("preserves Codex comments, formatting, and order outside generated paths", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });

    write(
      join(outputDir, "codex", "config.toml"),
      [
        "[mcp_servers.generated]",
        'command = "node"',
        "",
        "[mcp_servers.generated.env]",
        'TOKEN = "generated"',
        "",
      ].join("\n"),
    );
    const existing = [
      "# --- Headroom persistent provider ---",
      'model_provider = "headroom"',
      'openai_base_url = "http://127.0.0.1:8787/v1"',
      "",
      "notify = [",
      '  "C:\\\\Users\\\\Nejc\\\\codex-computer-use.exe",',
      '  "turn-ended",',
      "]",
      "matrix = [",
      "  [1, 2],",
      "  [3, 4],",
      "]",
      'message = """',
      "[not.a.table]",
      '"""',
      "[model_providers.headroom]",
      'name = "Headroom persistent proxy"',
      'base_url = "http://127.0.0.1:8787/v1"',
      "supports_websockets = true",
      "requires_openai_auth = true",
      "# --- end Headroom persistent provider ---",
      "",
    ].join("\r\n");
    write(join(userHome, ".codex", "config.toml"), existing);

    await runInstall({
      sourceDir,
      outputDir,
      destBase: userHome,
      userHome,
      platforms: ["codex"],
      rebuild: false,
      logger: silentLogger,
    });

    const installed = read(join(userHome, ".codex", "config.toml"));
    expect(installed.startsWith(existing)).toBe(true);
    expect(installed.slice(existing.length)).toContain("[mcp_servers]");
    expect(readMergeableConfig(join(userHome, ".codex", "config.toml"))).toMatchObject({
      model_provider: "headroom",
      model_providers: { headroom: { requires_openai_auth: true } },
      mcp_servers: { generated: { command: "node", env: { TOKEN: "generated" } } },
    });
  });

  it("merges Codex implicit parents, inline tables, and arrays of tables at the correct paths", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });

    write(
      join(outputDir, "codex", "config.toml"),
      [
        "[windows]",
        'sandbox = "elevated"',
        "",
        "[mcp_servers.generated]",
        'command = "node"',
        "",
        "[mcp_servers.generated.env]",
        'TOKEN = "generated"',
        "",
        "[[plugins]]",
        'name = "one"',
        "",
        "[[plugins]]",
        'name = "two"',
        "",
      ].join("\n"),
    );
    write(
      join(userHome, ".codex", "config.toml"),
      [
        "# keep this comment",
        'mcp_servers = { keep = { command = "old" } }',
        "",
        "[windows.policy]",
        "enabled = true",
        "",
      ].join("\n"),
    );

    await runInstall({
      sourceDir,
      outputDir,
      destBase: userHome,
      userHome,
      platforms: ["codex"],
      rebuild: false,
      logger: silentLogger,
    });

    const installedPath = join(userHome, ".codex", "config.toml");
    expect(read(installedPath)).toContain("# keep this comment");
    expect(readMergeableConfig(installedPath)).toEqual({
      mcp_servers: {
        keep: { command: "old" },
        generated: { command: "node", env: { TOKEN: "generated" } },
      },
      windows: { policy: { enabled: true }, sandbox: "elevated" },
      plugins: [{ name: "one" }, { name: "two" }],
    });
  });

  it("merges nested Codex arrays of tables without patching errors", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });

    write(
      join(outputDir, "codex", "config.toml"),
      [
        "[[skills.config]]",
        'path = "skills/example/SKILL.md"',
        "enabled = false",
        "",
        "[[skills.config]]",
        'path = "../.agents/skills/example/SKILL.md"',
        "enabled = false",
        "",
      ].join("\n"),
    );

    await runInstall({
      sourceDir,
      outputDir,
      destBase: userHome,
      userHome,
      platforms: ["codex"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(readMergeableConfig(join(userHome, ".codex", "config.toml"))).toEqual({
      skills: {
        config: [
          { path: "skills/example/SKILL.md", enabled: false },
          { path: "../.agents/skills/example/SKILL.md", enabled: false },
        ],
      },
    });
  });

  it("replaces conflicting Codex table and array-of-tables representations", async () => {
    const cases = [
      {
        existing: ["# keep table transition", "unrelated = true", "", "[plugins]", 'name = "old"', ""].join("\n"),
        generated: ["[[plugins]]", 'name = "new"', ""].join("\n"),
        expected: [{ name: "new" }],
      },
      {
        existing: ["# keep inline transition", "unrelated = true", 'plugins = [{ name = "old" }]', ""].join("\n"),
        generated: ["[[plugins]]", 'name = "new"', ""].join("\n"),
        expected: [{ name: "new" }],
      },
      {
        existing: ["# keep array transition", "unrelated = true", "", "[[plugins]]", 'name = "old"', ""].join("\n"),
        generated: ["[plugins]", 'name = "new"', ""].join("\n"),
        expected: { name: "new" },
      },
    ] as const;

    for (const testCase of cases) {
      const root = createTempRoot();
      const sourceDir = join(root, ".ulis");
      const outputDir = join(sourceDir, "generated");
      const userHome = join(root, "home");
      mkdirSync(sourceDir, { recursive: true });
      mkdirSync(userHome, { recursive: true });
      write(join(outputDir, "codex", "config.toml"), testCase.generated);
      write(join(userHome, ".codex", "config.toml"), testCase.existing);

      await runInstall({
        sourceDir,
        outputDir,
        destBase: userHome,
        userHome,
        platforms: ["codex"],
        rebuild: false,
        logger: silentLogger,
      });

      const installedPath = join(userHome, ".codex", "config.toml");
      const installed = read(installedPath);
      expect(installed).toContain(testCase.existing.split("\n")[0]!);
      expect(readMergeableConfig(installedPath)).toEqual({
        unrelated: true,
        plugins: testCase.expected,
      });
    }
  });

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
