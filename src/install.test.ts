import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Logger } from "./build.js";
import { __test, resolveRunner, runInstall } from "./install.js";
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
  it("preserves allowlisted Codex config sections for project installs", async () => {
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

  it("preserves allowlisted Codex config sections for global installs", async () => {
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
      approval_policy: "on-request",
      notice: "existing",
      features: { responses: true },
      tui: { show_raw_agent_reasoning: true },
      projects: { "/global": { trust_level: "trusted" } },
    });
  });

  it("preserves allowlisted native config across platform installs", async () => {
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
      join(projectDir, ".claude.json"),
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
      hooks: { PreToolUse: [{ matcher: "existing" }] },
      statusLine: { type: "command", command: "bash ~/.claude/statusline.sh" },
      enabledPlugins: { "plugin@example": true },
      extraKnownMarketplaces: { example: { source: { source: "github", repo: "owner/repo" } } },
      autoUpdatesChannel: "latest",
      agentPushNotifEnabled: true,
      theme: "dark",
      permissions: { allow: ["Bash(git status)"] },
    });
    expect(JSON.parse(read(join(projectDir, ".claude.json")))).toEqual({
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

  it("removes stale Codex config when generated config is absent and no allowlisted keys exist", async () => {
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
    expect(existsSync(join(projectDir, ".codex", "config.toml"))).toBe(false);
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
