// runInstall: Codex config.toml overlay merging - generated-value overlay, comment/formatting/order
// preservation outside generated paths, implicit-parent/inline-table/array-of-tables merging, and
// conflicting table-representation replacement.
import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { __test, runInstall } from "./install.js";
import { cleanupInstallTempRoots, createTempRoot, read, silentLogger, write } from "./test-utils/install.js";
import { readMergeableConfig } from "./utils/config-merge.js";

afterEach(() => {
  __test.resetRuntimeDependencies();
  cleanupInstallTempRoots();
});

describe("runInstall", () => {
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
});
