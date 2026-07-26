import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Logger } from "./build.js";
import { __test, resolveRunner, runInstall, runPresetInstall } from "./install.js";
import { readMergeableConfig } from "./utils/config-merger.js";

const tmpRoots: string[] = [];

const silentLogger: Logger = {
  info() {},
  success() {},
  warn() {},
  error() {},
  dim() {},
  header() {},
};

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-install-"));
  tmpRoots.push(root);
  return root;
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

function createForgecodeOutput(outputDir: string): void {
  write(join(outputDir, "forgecode", "AGENTS.md"), "Forge global instructions.\n");
  write(join(outputDir, "forgecode", ".forge", ".mcp.json"), JSON.stringify({ mcpServers: {} }, null, 2));
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for condition.");
}

afterEach(() => {
  __test.resetRuntimeDependencies();
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
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

  it("installs ForgeCode AGENTS.md into the Forge home directory for global installs", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    createForgecodeOutput(outputDir);

    await runInstall({
      sourceDir,
      outputDir,
      destBase: userHome,
      userHome,
      platforms: ["forgecode"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(read(join(userHome, ".forge", "AGENTS.md"))).toBe("Forge global instructions.\n");
    expect(existsSync(join(userHome, "AGENTS.md"))).toBe(false);
  });

  it("installs ForgeCode AGENTS.md into the Forge project config directory for project installs", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    createForgecodeOutput(outputDir);

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["forgecode"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(read(join(projectDir, ".forge", "AGENTS.md"))).toBe("Forge global instructions.\n");
    expect(existsSync(join(projectDir, "AGENTS.md"))).toBe(false);
  });

  it("skips extension installs when installExtensions is false", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    createForgecodeOutput(outputDir);
    write(
      join(sourceDir, "extensions.yaml"),
      ["forgecode:", "  extensions:", "    - name: this-package-does-not-exist@latest", ""].join("\n"),
    );

    const logs: string[] = [];
    const recordingLogger: Logger = {
      info(msg) {
        logs.push(`info:${msg}`);
      },
      success() {},
      warn(msg) {
        logs.push(`warn:${msg}`);
      },
      error() {},
      dim() {},
      header() {},
    };

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["forgecode"],
      rebuild: false,
      installExtensions: false,
      logger: recordingLogger,
    });

    expect(logs.some((line) => line.includes("Will run:"))).toBe(false);
    expect(logs.some((line) => line.includes("this-package-does-not-exist"))).toBe(false);
  });

  it("scopes wildcard skill installs to selected project platforms", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    write(join(outputDir, "codex", "AGENTS.md"), "Codex instructions.\n");
    write(join(sourceDir, "skills.yaml"), ['"*":', "  skills:", "    - name: test/skill", ""].join("\n"));

    const commands: Array<{ command: string; args: readonly string[] }> = [];
    __test.setRuntimeDependencies({
      runCommand(command, args) {
        commands.push({ command, args });
        return { status: 0, stdout: "", stderr: "" } as never;
      },
      async runAsyncCommand(command, args) {
        commands.push({ command, args });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["codex"],
      rebuild: false,
      logger: silentLogger,
    });

    const skillsCommands = commands.filter((command) => command.command === "npx");
    expect(skillsCommands).toHaveLength(1);
    expect(skillsCommands[0]!.args).toContain("codex");
    expect(skillsCommands[0]!.args).toContain("--project");
    expect(skillsCommands[0]!.args).not.toContain("opencode");
    expect(skillsCommands[0]!.args).not.toContain("claude-code");
    expect(skillsCommands[0]!.args).not.toContain("cursor");
  });

  it("skips external skill installs when installSkills is false", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    write(join(outputDir, "codex", "AGENTS.md"), "Codex instructions.\n");
    write(join(sourceDir, "skills.yaml"), ['"*":', "  skills:", "    - name: test/skill", ""].join("\n"));

    const commands: Array<{ command: string; args: readonly string[] }> = [];
    __test.setRuntimeDependencies({
      runCommand(command, args) {
        commands.push({ command, args });
        return { status: 0, stdout: "", stderr: "" } as never;
      },
      async runAsyncCommand(command, args) {
        commands.push({ command, args });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["codex"],
      rebuild: false,
      installSkills: false,
      logger: silentLogger,
    });

    expect(commands.filter((command) => command.command === "npx")).toHaveLength(0);
  });

  it("scopes wildcard skill installs to selected global platforms", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    write(join(outputDir, "claude", "settings.json"), "{}\n");
    write(join(sourceDir, "skills.yaml"), ['"*":', "  skills:", "    - name: test/skill", ""].join("\n"));

    const commands: Array<{ command: string; args: readonly string[] }> = [];
    __test.setRuntimeDependencies({
      runCommand(command, args) {
        commands.push({ command, args });
        return { status: 0, stdout: "", stderr: "" } as never;
      },
      async runAsyncCommand(command, args) {
        commands.push({ command, args });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    await runInstall({
      sourceDir,
      outputDir,
      destBase: userHome,
      userHome,
      platforms: ["claude"],
      rebuild: false,
      logger: silentLogger,
    });

    const skillsCommands = commands.filter((command) => command.command === "npx");
    expect(skillsCommands).toHaveLength(1);
    expect(skillsCommands[0]!.args).toContain("claude-code");
    expect(skillsCommands[0]!.args).toContain("-g");
    expect(skillsCommands[0]!.args).not.toContain("--project");
    expect(skillsCommands[0]!.args).not.toContain("opencode");
    expect(skillsCommands[0]!.args).not.toContain("codex");
    expect(skillsCommands[0]!.args).not.toContain("cursor");
  });

  it("splits each skill argument line into command arguments", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    write(join(outputDir, "codex", "AGENTS.md"), "Codex instructions.\n");
    write(
      join(sourceDir, "skills.yaml"),
      ["codex:", "  skills:", "    - name: test/repo", '      args: ["--skill selected", "--other value"]', ""].join(
        "\n",
      ),
    );

    const commands: Array<{ command: string; args: readonly string[] }> = [];
    __test.setRuntimeDependencies({
      async runAsyncCommand(command, args) {
        commands.push({ command, args });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["codex"],
      rebuild: false,
      logger: silentLogger,
    });

    const command = commands.find((call) => call.args.includes("test/repo"));
    expect(command?.args).toContain("--skill");
    expect(command?.args).toContain("selected");
    expect(command?.args).toContain("--other");
    expect(command?.args).toContain("value");
    expect(command?.args).not.toContain("--skill selected");
    expect(command?.args).not.toContain("--other value");
  });

  it("runs external skill installs with bounded concurrency", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    write(join(outputDir, "codex", "AGENTS.md"), "Codex instructions.\n");
    write(
      join(sourceDir, "skills.yaml"),
      [
        "codex:",
        "  skills:",
        "    - name: skill/one",
        "    - name: skill/two",
        "    - name: skill/three",
        "    - name: skill/four",
        "    - name: skill/five",
        "",
      ].join("\n"),
    );

    let activeCommands = 0;
    let maxActiveCommands = 0;
    const commands: Array<{ command: string; args: readonly string[] }> = [];
    const releases: Array<() => void> = [];
    __test.setRuntimeDependencies({
      async runAsyncCommand(command, args) {
        commands.push({ command, args });
        activeCommands += 1;
        maxActiveCommands = Math.max(maxActiveCommands, activeCommands);
        await new Promise<void>((resolve) => releases.push(resolve));
        activeCommands -= 1;
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    const install = runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["codex"],
      rebuild: false,
      logger: silentLogger,
    });

    await waitFor(() => commands.length === 4);
    expect(maxActiveCommands).toBe(4);
    for (const release of releases.splice(0)) release();
    await waitFor(() => commands.length === 5);
    for (const release of releases.splice(0)) release();
    await install;

    expect(commands.filter((command) => command.command === "npx")).toHaveLength(5);
    expect(maxActiveCommands).toBe(4);
  });

  it("continues queued skill installs after a failure without streaming child output", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    write(join(outputDir, "codex", "AGENTS.md"), "Codex instructions.\n");
    write(
      join(sourceDir, "skills.yaml"),
      ["codex:", "  skills:", "    - name: skill/bad", "    - name: skill/good", ""].join("\n"),
    );

    const logs: string[] = [];
    const recordingLogger: Logger = {
      info(msg) {
        logs.push(`info:${msg}`);
      },
      success(msg) {
        logs.push(`success:${msg}`);
      },
      warn(msg) {
        logs.push(`warn:${msg}`);
      },
      error() {},
      dim(msg) {
        logs.push(`dim:${msg}`);
      },
      header() {},
    };
    __test.setRuntimeDependencies({
      async runAsyncCommand(_command, args) {
        if (args.includes("skill/bad")) {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { status: 1, stdout: "stdout noise\n", stderr: "first detail\nlast detail\n" };
        }
        return { status: 0, stdout: "success noise\n", stderr: "" };
      },
    });

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["codex"],
      rebuild: false,
      logger: recordingLogger,
    });

    expect(logs).toContain("warn:Failed to install codex skill: skill/bad (last detail)");
    expect(logs).toContain("success:codex skill: skill/good");
    expect(logs.indexOf("warn:Failed to install codex skill: skill/bad (last detail)")).toBeLessThan(
      logs.indexOf("success:codex skill: skill/good"),
    );
    expect(logs).not.toContain("dim:stdout noise");
    expect(logs).not.toContain("warn:first detail");
  });

  it("copies generated local skills into each platform without delegating to the skills CLI", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });

    write(join(sourceDir, "skills", "shared", "SKILL.md"), "---\nname: shared\ndescription: Shared\n---\nShared.\n");

    write(join(outputDir, "claude", "skills", "shared", "SKILL.md"), "Generated shared (claude).\n");
    write(join(outputDir, "codex", "skills", "shared", "SKILL.md"), "Generated shared (codex).\n");
    write(join(outputDir, "cursor", "skills", "shared", "SKILL.md"), "Generated shared (cursor).\n");
    write(join(outputDir, "opencode", "skills", "shared", "SKILL.md"), "Generated shared (opencode).\n");
    createForgecodeOutput(outputDir);
    write(join(outputDir, "forgecode", ".forge", "skills", "shared", "SKILL.md"), "Generated shared (forge).\n");

    const commands: Array<{ command: string; args: readonly string[] }> = [];
    __test.setRuntimeDependencies({
      async runAsyncCommand(command, args) {
        commands.push({ command, args });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["claude", "codex", "cursor", "opencode", "forgecode"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(read(join(projectDir, ".claude", "skills", "shared", "SKILL.md"))).toBe("Generated shared (claude).\n");
    expect(read(join(projectDir, ".codex", "skills", "shared", "SKILL.md"))).toBe("Generated shared (codex).\n");
    expect(read(join(projectDir, ".cursor", "skills", "shared", "SKILL.md"))).toBe("Generated shared (cursor).\n");
    expect(read(join(projectDir, ".opencode", "skills", "shared", "SKILL.md"))).toBe("Generated shared (opencode).\n");
    expect(read(join(projectDir, ".forge", "skills", "shared", "SKILL.md"))).toBe("Generated shared (forge).\n");

    expect(existsSync(join(outputDir, ".linked-local-skills"))).toBe(false);
    expect(commands).toHaveLength(0);
  });

  it("preserves unmanaged agents and skills while replacing generated same-name entries", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });

    write(join(outputDir, "claude", "agents", "managed.md"), "Generated claude agent.\n");
    write(join(outputDir, "claude", "skills", "managed", "SKILL.md"), "Generated claude skill.\n");
    write(join(outputDir, "codex", "agents", "managed.toml"), "Generated codex agent.\n");
    write(join(outputDir, "codex", "skills", "managed", "SKILL.md"), "Generated codex skill.\n");
    write(join(outputDir, "cursor", "agents", "managed.mdc"), "Generated cursor agent.\n");
    write(join(outputDir, "cursor", "skills", "managed", "SKILL.md"), "Generated cursor skill.\n");
    write(join(outputDir, "opencode", "agents", "specialized", "managed.md"), "Generated opencode agent.\n");
    write(join(outputDir, "opencode", "skills", "managed", "SKILL.md"), "Generated opencode skill.\n");
    createForgecodeOutput(outputDir);
    write(join(outputDir, "forgecode", ".forge", "agents", "managed.md"), "Generated forge agent.\n");
    write(join(outputDir, "forgecode", ".forge", "skills", "managed", "SKILL.md"), "Generated forge skill.\n");

    write(join(projectDir, ".claude", "agents", "managed.md"), "Old claude agent.\n");
    write(join(projectDir, ".claude", "agents", "local.md"), "Local claude agent.\n");
    write(join(projectDir, ".claude", "skills", "managed", "SKILL.md"), "Old claude skill.\n");
    write(join(projectDir, ".claude", "skills", "local", "SKILL.md"), "Local claude skill.\n");
    write(join(projectDir, ".codex", "agents", "managed.toml"), "Old codex agent.\n");
    write(join(projectDir, ".codex", "agents", "local.toml"), "Local codex agent.\n");
    write(join(projectDir, ".codex", "skills", "managed", "SKILL.md"), "Old codex skill.\n");
    write(join(projectDir, ".codex", "skills", "local", "SKILL.md"), "Local codex skill.\n");
    write(join(projectDir, ".cursor", "agents", "managed.mdc"), "Old cursor agent.\n");
    write(join(projectDir, ".cursor", "agents", "local.mdc"), "Local cursor agent.\n");
    write(join(projectDir, ".cursor", "skills", "managed", "SKILL.md"), "Old cursor skill.\n");
    write(join(projectDir, ".cursor", "skills", "local", "SKILL.md"), "Local cursor skill.\n");
    write(join(projectDir, ".opencode", "agents", "specialized", "managed.md"), "Old opencode agent.\n");
    write(join(projectDir, ".opencode", "agents", "specialized", "local.md"), "Local opencode agent.\n");
    write(join(projectDir, ".opencode", "skills", "managed", "SKILL.md"), "Old opencode skill.\n");
    write(join(projectDir, ".opencode", "skills", "local", "SKILL.md"), "Local opencode skill.\n");
    write(join(projectDir, ".forge", "agents", "managed.md"), "Old forge agent.\n");
    write(join(projectDir, ".forge", "agents", "local.md"), "Local forge agent.\n");
    write(join(projectDir, ".forge", "skills", "managed", "SKILL.md"), "Old forge skill.\n");
    write(join(projectDir, ".forge", "skills", "local", "SKILL.md"), "Local forge skill.\n");

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["claude", "codex", "cursor", "opencode", "forgecode"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(read(join(projectDir, ".claude", "agents", "managed.md"))).toBe("Generated claude agent.\n");
    expect(read(join(projectDir, ".claude", "agents", "local.md"))).toBe("Local claude agent.\n");
    expect(read(join(projectDir, ".claude", "skills", "managed", "SKILL.md"))).toBe("Generated claude skill.\n");
    expect(read(join(projectDir, ".claude", "skills", "local", "SKILL.md"))).toBe("Local claude skill.\n");
    expect(read(join(projectDir, ".codex", "agents", "managed.toml"))).toBe("Generated codex agent.\n");
    expect(read(join(projectDir, ".codex", "agents", "local.toml"))).toBe("Local codex agent.\n");
    expect(read(join(projectDir, ".codex", "skills", "managed", "SKILL.md"))).toBe("Generated codex skill.\n");
    expect(read(join(projectDir, ".codex", "skills", "local", "SKILL.md"))).toBe("Local codex skill.\n");
    expect(read(join(projectDir, ".cursor", "agents", "managed.mdc"))).toBe("Generated cursor agent.\n");
    expect(read(join(projectDir, ".cursor", "agents", "local.mdc"))).toBe("Local cursor agent.\n");
    expect(read(join(projectDir, ".cursor", "skills", "managed", "SKILL.md"))).toBe("Generated cursor skill.\n");
    expect(read(join(projectDir, ".cursor", "skills", "local", "SKILL.md"))).toBe("Local cursor skill.\n");
    expect(read(join(projectDir, ".opencode", "agents", "specialized", "managed.md"))).toBe(
      "Generated opencode agent.\n",
    );
    expect(read(join(projectDir, ".opencode", "agents", "specialized", "local.md"))).toBe("Local opencode agent.\n");
    expect(read(join(projectDir, ".opencode", "skills", "managed", "SKILL.md"))).toBe("Generated opencode skill.\n");
    expect(read(join(projectDir, ".opencode", "skills", "local", "SKILL.md"))).toBe("Local opencode skill.\n");
    expect(read(join(projectDir, ".forge", "agents", "managed.md"))).toBe("Generated forge agent.\n");
    expect(read(join(projectDir, ".forge", "agents", "local.md"))).toBe("Local forge agent.\n");
    expect(read(join(projectDir, ".forge", "skills", "managed", "SKILL.md"))).toBe("Generated forge skill.\n");
    expect(read(join(projectDir, ".forge", "skills", "local", "SKILL.md"))).toBe("Local forge skill.\n");
  });

  it("removes OpenCode same-name agents from the old category when the generated category changes", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });

    write(join(outputDir, "opencode", "agents", "specialized", "worker.md"), "Generated worker.\n");
    write(join(outputDir, "opencode", "agents", "core", "reviewer.md"), "Generated reviewer.\n");
    write(join(projectDir, ".opencode", "agents", "core", "worker.md"), "Old core worker.\n");
    write(join(projectDir, ".opencode", "agents", "core", "local.md"), "Local core agent.\n");
    write(join(projectDir, ".opencode", "agents", "specialized", "reviewer.md"), "Old specialized reviewer.\n");
    write(join(projectDir, ".opencode", "agents", "specialized", "local.md"), "Local specialized agent.\n");

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["opencode"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(existsSync(join(projectDir, ".opencode", "agents", "core", "worker.md"))).toBe(false);
    expect(read(join(projectDir, ".opencode", "agents", "core", "reviewer.md"))).toBe("Generated reviewer.\n");
    expect(read(join(projectDir, ".opencode", "agents", "core", "local.md"))).toBe("Local core agent.\n");
    expect(read(join(projectDir, ".opencode", "agents", "specialized", "worker.md"))).toBe("Generated worker.\n");
    expect(existsSync(join(projectDir, ".opencode", "agents", "specialized", "reviewer.md"))).toBe(false);
    expect(read(join(projectDir, ".opencode", "agents", "specialized", "local.md"))).toBe("Local specialized agent.\n");
  });

  it("prunes stale OpenCode non-agent and non-skill entries while preserving unmanaged agents and skills", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });

    write(join(outputDir, "opencode", "AGENTS.md"), "Generated instructions.\n");
    write(join(projectDir, ".opencode", "commands", "old.md"), "Old command.\n");
    write(join(projectDir, ".opencode", "docs", "old.md"), "Old docs.\n");
    write(join(projectDir, ".opencode", "agents", "specialized", "local.md"), "Local agent.\n");
    write(join(projectDir, ".opencode", "skills", "local", "SKILL.md"), "Local skill.\n");

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
    expect(existsSync(join(projectDir, ".opencode", "commands", "old.md"))).toBe(false);
    expect(existsSync(join(projectDir, ".opencode", "docs", "old.md"))).toBe(false);
    expect(read(join(projectDir, ".opencode", "agents", "specialized", "local.md"))).toBe("Local agent.\n");
    expect(read(join(projectDir, ".opencode", "skills", "local", "SKILL.md"))).toBe("Local skill.\n");
  });

  it("writes Claude MCP servers to <project>/.mcp.json on a project install", async () => {
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
      join(outputDir, "claude", ".claude.json"),
      JSON.stringify({ mcpServers: { shared: { command: "generated" } } }, null, 2),
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

    expect(existsSync(join(projectDir, ".mcp.json"))).toBe(true);
    expect(existsSync(join(projectDir, ".claude.json"))).toBe(false);
    expect(JSON.parse(read(join(projectDir, ".mcp.json")))).toEqual({
      mcpServers: { shared: { command: "generated" } },
    });
  });

  it("writes Claude MCP servers to <home>/.claude.json on a global install", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });

    write(join(outputDir, "claude", "settings.json"), "{}");
    write(
      join(outputDir, "claude", ".claude.json"),
      JSON.stringify({ mcpServers: { shared: { command: "generated" } } }, null, 2),
    );

    await runInstall({
      sourceDir,
      outputDir,
      destBase: userHome,
      userHome,
      platforms: ["claude"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(existsSync(join(userHome, ".claude.json"))).toBe(true);
    expect(existsSync(join(userHome, ".mcp.json"))).toBe(false);
    expect(JSON.parse(read(join(userHome, ".claude.json")))).toEqual({
      mcpServers: { shared: { command: "generated" } },
    });
  });

  it("overlays generated MCP servers into ~/.claude.json without removing unmanaged servers", async () => {
    // Regression: ULIS used to capture only the `mcpServers` slice of an
    // existing ~/.claude.json and write back just that slice, wiping every
    // other key (projects, enabledPlugins, theme, history, ...). Global Claude
    // installs must preserve user-owned keys and unmanaged MCP servers while
    // overwriting generated values at the same paths.
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });

    write(join(outputDir, "claude", "settings.json"), "{}");
    write(
      join(outputDir, "claude", ".claude.json"),
      JSON.stringify({ mcpServers: { shared: { command: "generated" } } }, null, 2),
    );
    write(
      join(userHome, ".claude.json"),
      JSON.stringify(
        {
          // Claude Code-owned state that MUST survive an install:
          theme: "dark",
          projects: { "/home/me/repo": { lastModified: "2026-05-15", history: ["msg1", "msg2"] } },
          enabledPlugins: { "marketplace@example": true },
          autoUpdatesChannel: "latest",
          telemetryStatus: "enabled",
          // Existing MCP servers are merged by name:
          mcpServers: { existing: { command: "old" }, shared: { command: "old" } },
        },
        null,
        2,
      ),
    );

    await runInstall({
      sourceDir,
      outputDir,
      destBase: userHome,
      userHome,
      platforms: ["claude"],
      rebuild: false,
      logger: silentLogger,
    });

    // Existing state and unmanaged MCP servers survive; generated conflicts win.
    expect(JSON.parse(read(join(userHome, ".claude.json")))).toEqual({
      theme: "dark",
      projects: { "/home/me/repo": { lastModified: "2026-05-15", history: ["msg1", "msg2"] } },
      enabledPlugins: { "marketplace@example": true },
      autoUpdatesChannel: "latest",
      telemetryStatus: "enabled",
      mcpServers: {
        existing: { command: "old" },
        shared: { command: "generated" },
      },
    });
  });

  it("keeps user-owned ~/.claude.json keys intact when no MCP servers are generated", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });

    write(join(outputDir, "claude", "settings.json"), "{}");
    // No generated .claude.json (empty mcp.yaml scenario).
    write(
      join(userHome, ".claude.json"),
      JSON.stringify(
        {
          theme: "dark",
          projects: { "/home/me/repo": { lastModified: "2026-05-15" } },
          mcpServers: { stale: { command: "old" } },
        },
        null,
        2,
      ),
    );

    await runInstall({
      sourceDir,
      outputDir,
      destBase: userHome,
      userHome,
      platforms: ["claude"],
      rebuild: false,
      logger: silentLogger,
    });

    // No generated file means the existing file is left unchanged.
    expect(JSON.parse(read(join(userHome, ".claude.json")))).toEqual({
      theme: "dark",
      projects: { "/home/me/repo": { lastModified: "2026-05-15" } },
      mcpServers: { stale: { command: "old" } },
    });
  });

  it("preserves an existing project .mcp.json and merges with generated mcpServers", async () => {
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
      join(outputDir, "claude", ".claude.json"),
      JSON.stringify({ mcpServers: { shared: { command: "generated" } } }, null, 2),
    );
    write(
      join(projectDir, ".mcp.json"),
      JSON.stringify({ mcpServers: { teamOnly: { command: "team" }, shared: { command: "old" } } }, null, 2),
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

    expect(JSON.parse(read(join(projectDir, ".mcp.json")))).toEqual({
      mcpServers: { teamOnly: { command: "team" }, shared: { command: "generated" } },
    });
  });
});

describe("runPresetInstall", () => {
  it("installs selected presets without a base source or persistent generated output", async () => {
    const root = createTempRoot();
    const presetA = join(root, "preset-a");
    const presetB = join(root, "preset-b");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    write(join(presetA, "config.yaml"), "version: 1\nname: preset-a\n");
    write(
      join(presetA, "agents", "worker.md"),
      "---\ndescription: From preset A\nmodel: claude-haiku-4-5-20251001\ntools:\n  read: true\n---\n\nPreset A body.\n",
    );
    write(join(presetA, "commands", "from-a.md"), "---\ndescription: From A\n---\n\nCommand A.\n");
    write(join(presetA, "raw", "claude", "from-a.txt"), "raw A\n");
    write(join(presetA, "raw", "claude", "shared.txt"), "raw A shared\n");
    write(join(presetB, "config.yaml"), "version: 1\nname: preset-b\n");
    write(
      join(presetB, "agents", "worker.md"),
      "---\ndescription: From preset B\nmodel: claude-haiku-4-5-20251001\ntools:\n  read: true\n---\n\nPreset B body.\n",
    );
    write(join(presetB, "commands", "from-b.md"), "---\ndescription: From B\n---\n\nCommand B.\n");
    write(join(presetB, "raw", "claude", "from-b.txt"), "raw B\n");
    write(join(presetB, "raw", "claude", "shared.txt"), "raw B shared\n");

    await runPresetInstall({
      presets: [
        { name: "a", dir: presetA },
        { name: "b", dir: presetB },
      ],
      destBase: projectDir,
      userHome,
      platforms: ["claude"],
      logger: silentLogger,
    });

    const installedAgent = read(join(projectDir, ".claude", "agents", "worker.md"));
    expect(installedAgent).toContain("From preset B");
    expect(installedAgent).toContain("Preset B body.");
    expect(installedAgent).not.toContain("Preset A body.");
    expect(read(join(projectDir, ".claude", "commands", "from-a.md"))).toContain("Command A.");
    expect(read(join(projectDir, ".claude", "commands", "from-b.md"))).toContain("Command B.");
    expect(read(join(projectDir, ".claude", "from-a.txt"))).toBe("raw A\n");
    expect(read(join(projectDir, ".claude", "from-b.txt"))).toBe("raw B\n");
    expect(read(join(projectDir, ".claude", "shared.txt"))).toBe("raw B shared\n");
    expect(existsSync(join(presetA, "generated"))).toBe(false);
    expect(existsSync(join(presetB, "generated"))).toBe(false);
  });

  it("runs preset-declared external skills and extensions only", async () => {
    const root = createTempRoot();
    const presetDir = join(root, "preset");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    write(join(presetDir, "config.yaml"), "version: 1\nname: preset\nrunner: npx\n");
    write(
      join(presetDir, "agents", "worker.md"),
      "---\ndescription: Preset worker\nmodel: claude-haiku-4-5-20251001\ntools:\n  read: true\n---\n\nPreset worker.\n",
    );
    write(join(presetDir, "skills.yaml"), ["codex:", "  skills:", "    - name: preset/skill", ""].join("\n"));
    write(
      join(presetDir, "extensions.yaml"),
      ["codex:", "  extensions:", "    - name: preset-extension@latest", "      args: [install]", ""].join("\n"),
    );

    const commands: Array<{ command: string; args: readonly string[] }> = [];
    __test.setRuntimeDependencies({
      runCommand(command, args) {
        commands.push({ command, args });
        return { status: 0, stdout: "", stderr: "" } as never;
      },
      async runAsyncCommand(command, args) {
        commands.push({ command, args });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    await runPresetInstall({
      presets: [{ name: "preset", dir: presetDir }],
      destBase: projectDir,
      userHome,
      platforms: ["codex"],
      runner: "bunx",
      logger: silentLogger,
    });

    expect(commands.some((call) => call.command === "npx" && call.args.includes("preset/skill"))).toBe(true);
    expect(commands.some((call) => call.command === "bunx" && call.args.includes("preset-extension@latest"))).toBe(
      true,
    );
    expect(commands.some((call) => call.command === "npx" && call.args.includes("preset-extension@latest"))).toBe(
      false,
    );
  });

  it("writes Claude MCP servers to <home>/.claude.json on a global preset install", async () => {
    const root = createTempRoot();
    const presetDir = join(root, "preset");
    const userHome = join(root, "home");
    mkdirSync(userHome, { recursive: true });
    write(join(presetDir, "config.yaml"), "version: 1\nname: preset\n");
    write(
      join(presetDir, "mcp.json"),
      JSON.stringify({
        servers: {
          shared: { type: "local", command: "node", args: ["server.js"], targets: ["claude"] },
        },
      }),
    );

    await runPresetInstall({
      presets: [{ name: "preset", dir: presetDir }],
      destBase: userHome,
      userHome,
      globalInstall: true,
      platforms: ["claude"],
      logger: silentLogger,
    });

    expect(existsSync(join(userHome, ".claude.json"))).toBe(true);
    expect(existsSync(join(userHome, ".mcp.json"))).toBe(false);
    expect(JSON.parse(read(join(userHome, ".claude.json")))).toEqual({
      mcpServers: { shared: { command: "node", args: ["server.js"] } },
    });
  });

  it("rejects empty preset install requests", async () => {
    const root = createTempRoot();
    await expect(
      runPresetInstall({ presets: [], destBase: root, userHome: root, logger: silentLogger }),
    ).rejects.toThrow("Select at least one preset to install.");
  });

  it("stops preset install when the signal is aborted", async () => {
    const root = createTempRoot();
    const presetDir = join(root, "preset");
    const projectDir = join(root, "project");
    mkdirSync(projectDir, { recursive: true });
    write(join(presetDir, "config.yaml"), "version: 1\nname: preset\n");
    const controller = new AbortController();
    controller.abort();

    await expect(
      runPresetInstall({
        presets: [{ name: "preset", dir: presetDir }],
        destBase: projectDir,
        userHome: root,
        platforms: ["claude"],
        logger: silentLogger,
        signal: controller.signal,
      }),
    ).rejects.toThrow("Preset install stopped by user.");
    expect(existsSync(join(projectDir, ".claude"))).toBe(false);
  });
});

describe("resolveRunner", () => {
  it("prefers the CLI flag over config and auto-detect", () => {
    expect(resolveRunner({ cliFlag: "bunx", configValue: "npx", hasCommand: () => true })).toBe("bunx");
    expect(resolveRunner({ cliFlag: "npx", configValue: "bunx", hasCommand: () => true })).toBe("npx");
  });

  it("falls back to config.yaml when no CLI flag is set", () => {
    expect(resolveRunner({ configValue: "bunx", hasCommand: () => false })).toBe("bunx");
    expect(resolveRunner({ configValue: "npx", hasCommand: () => true })).toBe("npx");
  });

  it("auto-detects bunx when present and falls back to npx otherwise", () => {
    expect(resolveRunner({ hasCommand: (cmd) => cmd === "bunx" })).toBe("bunx");
    expect(resolveRunner({ hasCommand: () => false })).toBe("npx");
  });
});
