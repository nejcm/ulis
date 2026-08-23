import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { type Logger } from "./build.js";
import { __test, runPresetInstall } from "./install.js";
import { formatCommandPreview } from "./install/preview.js";
import { cleanupInstallTempRoots, createTempRoot, read, silentLogger, write } from "./test-utils/install.js";

afterEach(() => {
  __test.resetRuntimeDependencies();
  cleanupInstallTempRoots();
});

describe("runPresetInstall", () => {
  it("-y discloses remote preset commands without prompting", async () => {
    const root = createTempRoot();
    const presetDir = join(root, "preset");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const logs: string[] = [];
    const questions: string[] = [];
    const commands: Array<{ command: string; args: readonly string[] }> = [];
    const record = (message: string) => logs.push(message);
    const logger: Logger = {
      info: record,
      success: record,
      warn: record,
      error: record,
      dim: record,
      header: record,
    };
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    write(join(presetDir, "config.yaml"), "version: 1\nname: preset\n");
    write(join(presetDir, "skills.yaml"), ["codex:", "  skills:", "    - name: preset/skill", ""].join("\n"));
    write(
      join(presetDir, "extensions.yaml"),
      ["codex:", "  extensions:", "    - name: preset/extension", ""].join("\n"),
    );
    __test.setRuntimeDependencies({
      runCommand: () => ({ status: 0, stdout: "", stderr: "" }) as never,
      async runAsyncCommand(command, args) {
        commands.push({ command, args });
        return { status: 0, stdout: "", stderr: "" };
      },
      async confirm(question) {
        questions.push(question);
        return false;
      },
    });

    await runPresetInstall({
      presets: [{ name: "preset", dir: presetDir, remoteUrl: "https://github.com/o/preset" }],
      destBase: projectDir,
      userHome,
      platforms: ["codex"],
      remoteSources: ["https://github.com/o/preset"],
      nonInteractive: true,
      logger,
      runner: "npx",
    });

    const disclosed = logs.filter((line) => line.startsWith("  ")).map((line) => line.slice(2));
    const spawned = commands.map(({ command, args }) => formatCommandPreview([command, ...args]));
    expect(questions).toHaveLength(0);
    expect(spawned).toHaveLength(2);
    expect(logs.filter((line) => line === "Remote Source Commands")).toHaveLength(1);
    expect(disclosed.filter((line) => spawned.includes(line))).toEqual(spawned);
  });

  it("counts failed skills and extensions in one summary and suppresses completion", async () => {
    const root = createTempRoot();
    const presetDir = join(root, "preset");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const logs: string[] = [];
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    write(join(presetDir, "config.yaml"), "version: 1\nname: preset\n");
    write(join(presetDir, "skills.yaml"), ["codex:", "  skills:", "    - name: preset/skill", ""].join("\n"));
    write(
      join(presetDir, "extensions.yaml"),
      ["codex:", "  extensions:", "    - name: preset/extension", ""].join("\n"),
    );
    __test.setRuntimeDependencies({
      runCommand: () => ({ status: 0, stdout: "", stderr: "" }) as never,
      async runAsyncCommand() {
        return { status: 1, stdout: "", stderr: "install failed" };
      },
    });
    const record = (message: string) => logs.push(message);
    const logger: Logger = {
      info: record,
      success: record,
      warn: record,
      error: record,
      dim: record,
      header: record,
    };

    const install = runPresetInstall({
      presets: [{ name: "preset", dir: presetDir }],
      destBase: projectDir,
      userHome,
      platforms: ["codex"],
      logger,
      runner: "npx",
    });

    await expect(install).rejects.toThrow("2 external skill or extension commands failed.");
    expect(logs.filter((line) => line.startsWith("Install summary"))).toEqual([
      "Install summary — installed: [codex], failed external skills: [codex: preset/skill], failed extensions: [codex: preset/extension]",
    ]);
    expect(logs).not.toContain("Preset Installation Complete");
  });

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

  it("reconciles ownership when preset-only installs change the authoritative set", async () => {
    const root = createTempRoot();
    const populatedPreset = join(root, "populated");
    const emptyPreset = join(root, "empty");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    write(join(populatedPreset, "config.yaml"), "version: 1\nname: populated\n");
    write(
      join(populatedPreset, "agents", "worker.md"),
      "---\ndescription: Worker\nmodel: claude-haiku-4-5-20251001\ntools:\n  read: true\n---\n\nWorker.\n",
    );
    write(join(emptyPreset, "config.yaml"), "version: 1\nname: empty\n");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });

    const options = {
      destBase: projectDir,
      userHome,
      platforms: ["claude"] as const,
      logger: silentLogger,
    };
    await runPresetInstall({ ...options, presets: [{ name: "populated", dir: populatedPreset }] });
    expect(existsSync(join(projectDir, ".claude", "agents", "worker.md"))).toBe(true);

    await runPresetInstall({ ...options, presets: [{ name: "empty", dir: emptyPreset }] });
    expect(existsSync(join(projectDir, ".claude", "agents", "worker.md"))).toBe(false);
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
    const shellOptions: Array<boolean | string | undefined> = [];
    __test.setRuntimeDependencies({
      runCommand(command, args) {
        commands.push({ command, args });
        return { status: 0, stdout: "", stderr: "" } as never;
      },
      async runAsyncCommand(command, args, options) {
        commands.push({ command, args });
        shellOptions.push(options.shell);
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
    expect(shellOptions).toEqual([process.platform === "win32", process.platform === "win32"]);
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
      mcpServers: { shared: { type: "stdio", command: "node", args: ["server.js"] } },
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
    ).rejects.toThrow("Install stopped by user.");
    expect(existsSync(join(projectDir, ".claude"))).toBe(false);
  });
});
