import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Logger } from "./build.js";
import { __test, resolveRunner, runInstall } from "./install.js";

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

afterEach(() => {
  __test.resetRuntimeDependencies();
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("runInstall", () => {
  it("installs ForgeCode AGENTS.md into the Forge home directory for global installs", () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    createForgecodeOutput(outputDir);

    runInstall({
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

  it("installs ForgeCode AGENTS.md into the Forge project config directory for project installs", () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    createForgecodeOutput(outputDir);

    runInstall({
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

  it("skips extension installs when installExtensions is false", () => {
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

    runInstall({
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

  it("scopes wildcard skill installs to selected project platforms", () => {
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
    });

    runInstall({
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

  it("scopes wildcard skill installs to selected global platforms", () => {
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
    });

    runInstall({
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
