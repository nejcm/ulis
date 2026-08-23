import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { type Logger } from "./build.js";
import { __test, runInstall } from "./install.js";
import { planRemoteCommands } from "./install/trust-gate.js";
import {
  cleanupInstallTempRoots,
  createForgecodeOutput,
  createTempRoot,
  read,
  silentLogger,
  waitFor,
  write,
} from "./test-utils/install.js";

afterEach(() => {
  __test.resetRuntimeDependencies();
  cleanupInstallTempRoots();
});

// runInstall: ForgeCode installs plus skills/extensions install behavior (concurrency, scoping, argv).
describe("runInstall", () => {
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
    const commands: string[] = [];
    __test.setRuntimeDependencies({
      runCommand(command) {
        commands.push(command);
        return { status: 0, stdout: "", stderr: "" } as never;
      },
      async runAsyncCommand(command) {
        commands.push(command);
        return { status: 0, stdout: "", stderr: "" };
      },
    });

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
      runner: "npx",
    });

    expect(logs.some((line) => line.includes("Will run:"))).toBe(false);
    expect(logs.some((line) => line.includes("this-package-does-not-exist"))).toBe(false);
    expect(commands).toHaveLength(0);
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
    expect(shellOptions).toEqual([process.platform === "win32"]);
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

  it("keeps preview and execution skill argv aligned for an inferred home-layout scope", async () => {
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

    const preview = planRemoteCommands({
      sourceDir,
      platforms: ["claude"],
      destBase: userHome,
      userHome,
      globalInstall: undefined,
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

    expect(preview).toEqual(["npx skills@latest add test/skill -a claude-code -g --yes"]);
    expect(commands.filter((command) => command.command === "npx")).toEqual([
      {
        command: "npx",
        args: ["skills@latest", "add", "test/skill", "-a", "claude-code", "-g", "--yes"],
      },
    ]);
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

    const install = runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["codex"],
      rebuild: false,
      logger: recordingLogger,
    });

    await expect(install).rejects.toThrow("1 external skill or extension command failed.");
    expect(logs).toContain("warn:Failed to install codex skill: skill/bad (last detail)");
    expect(logs).toContain("success:codex skill: skill/good");
    expect(logs).toContain("warn:Install summary — installed: [codex], failed external skills: [codex: skill/bad]");
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
});
