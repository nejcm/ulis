import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { type Logger } from "./build.js";
import { __test, runInstall } from "./install.js";
import { InstallError } from "./install/errors.js";
import { preflightOwnership } from "./install/manifest.js";
import {
  cleanupInstallTempRoots,
  createForgecodeOutput,
  createTempRoot,
  read,
  silentLogger,
  write,
} from "./test-utils/install.js";

afterEach(() => {
  __test.resetRuntimeDependencies();
  cleanupInstallTempRoots();
});

// runInstall: ownership-manifest lifecycle for managed agents/skills across platforms - adoption,
// validation, type-conflict aborts, path safety, case-rename handling, and pruning.
describe("runInstall", () => {
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
    for (const configDir of [".claude", ".codex", ".cursor", ".opencode", ".forge"]) {
      expect(existsSync(join(projectDir, configDir, ".ulis-manifest.json"))).toBe(true);
    }
  });

  it("prunes only previously managed agents and skills across every platform", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });

    const layouts = [
      ["claude", ".claude", "agents/managed.md", "skills/managed"],
      ["codex", ".codex", "agents/managed.toml", "skills/managed"],
      ["cursor", ".cursor", "agents/managed.mdc", "skills/managed"],
      ["opencode", ".opencode", "agents/specialized/managed.md", "skills/managed"],
      ["forgecode", ".forge", ".forge/agents/managed.md", ".forge/skills/managed"],
    ] as const;

    for (const [platform, configDir, agentPath, skillPath] of layouts) {
      const generatedRoot = join(outputDir, platform);
      write(join(generatedRoot, ...agentPath.split("/")), "Generated agent.\n");
      write(join(generatedRoot, ...skillPath.split("/"), "SKILL.md"), "Generated skill.\n");
      const destinationRoot = join(projectDir, configDir);
      write(join(destinationRoot, "agents", "local.md"), "Unmanaged agent.\n");
      write(join(destinationRoot, "skills", "local", "SKILL.md"), "Unmanaged skill.\n");
    }
    createForgecodeOutput(outputDir);

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["claude", "codex", "cursor", "opencode", "forgecode"],
      rebuild: false,
      logger: silentLogger,
    });

    for (const [platform, configDir, agentPath, skillPath] of layouts) {
      const generatedRoot = join(outputDir, platform);
      const nativeAgentPath = platform === "forgecode" ? agentPath.slice(".forge/".length) : agentPath;
      write(join(projectDir, configDir, ...nativeAgentPath.split("/")), "User-modified managed agent.\n");
      rmSync(join(generatedRoot, ...agentPath.split("/")));
      rmSync(join(generatedRoot, ...skillPath.split("/")), { recursive: true });
    }

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["claude", "codex", "cursor", "opencode", "forgecode"],
      rebuild: false,
      logger: silentLogger,
    });

    for (const [platform, configDir, agentPath, skillPath] of layouts) {
      const nativeAgentPath = platform === "forgecode" ? agentPath.slice(".forge/".length) : agentPath;
      const nativeSkillPath = platform === "forgecode" ? skillPath.slice(".forge/".length) : skillPath;
      expect(existsSync(join(projectDir, configDir, ...nativeAgentPath.split("/")))).toBe(false);
      expect(existsSync(join(projectDir, configDir, ...nativeSkillPath.split("/")))).toBe(false);
      expect(read(join(projectDir, configDir, "agents", "local.md"))).toBe("Unmanaged agent.\n");
      expect(read(join(projectDir, configDir, "skills", "local", "SKILL.md"))).toBe("Unmanaged skill.\n");
    }
  });

  it("--no-prune preserves stale entries and relinquishes their ownership", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const generatedAgent = join(outputDir, "claude", "agents", "managed.md");
    write(generatedAgent, "Generated agent.\n");
    mkdirSync(userHome, { recursive: true });

    const options = {
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["claude"] as const,
      rebuild: false,
      logger: silentLogger,
    };
    await runInstall(options);
    rmSync(generatedAgent);
    await runInstall({ ...options, prune: false });
    await runInstall(options);

    expect(read(join(projectDir, ".claude", "agents", "managed.md"))).toBe("Generated agent.\n");
    expect(JSON.parse(read(join(projectDir, ".claude", ".ulis-manifest.json")))).toMatchObject({
      agents: [],
      skills: [],
    });
  });

  it("leaves unselected platform entries and manifests untouched", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const claudeAgent = join(outputDir, "claude", "agents", "managed.md");
    const codexAgent = join(outputDir, "codex", "agents", "managed.toml");
    write(claudeAgent, "Claude agent.\n");
    write(codexAgent, "Codex agent.\n");
    mkdirSync(userHome, { recursive: true });

    const common = { sourceDir, outputDir, destBase: projectDir, userHome, rebuild: false, logger: silentLogger };
    await runInstall({ ...common, platforms: ["claude", "codex"] });
    const codexManifestPath = join(projectDir, ".codex", ".ulis-manifest.json");
    const previousCodexManifest = read(codexManifestPath);
    rmSync(claudeAgent);
    rmSync(codexAgent);

    await runInstall({ ...common, platforms: ["claude"] });

    expect(existsSync(join(projectDir, ".claude", "agents", "managed.md"))).toBe(false);
    expect(read(join(projectDir, ".codex", "agents", "managed.toml"))).toBe("Codex agent.\n");
    expect(read(codexManifestPath)).toBe(previousCodexManifest);
  });

  it("keeps the new entry after a case-only managed path rename", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const upperAgent = join(outputDir, "claude", "agents", "Worker.md");
    const lowerAgent = join(outputDir, "claude", "agents", "worker.md");
    write(upperAgent, "Upper name.\n");
    mkdirSync(userHome, { recursive: true });
    const options = {
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["claude"] as const,
      rebuild: false,
      logger: silentLogger,
    };

    await runInstall(options);
    renameSync(upperAgent, lowerAgent);
    write(lowerAgent, "Lower name.\n");
    await runInstall(options);

    expect(read(join(projectDir, ".claude", "agents", "worker.md"))).toBe("Lower name.\n");
    expect(JSON.parse(read(join(projectDir, ".claude", ".ulis-manifest.json"))).agents).toEqual(["agents/worker.md"]);
  });

  it("accepts safe agent filenames containing consecutive dots", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    write(join(outputDir, "claude", "agents", "foo..bar.md"), "Dotted agent.\n");
    mkdirSync(userHome, { recursive: true });

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["claude"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(read(join(projectDir, ".claude", "agents", "foo..bar.md"))).toBe("Dotted agent.\n");
  });

  it("aborts before mutation when a generated managed entry has the wrong type", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    write(join(outputDir, "claude", "AGENTS.md"), "Generated Claude.\n");
    write(join(outputDir, "codex", "agents", "not-a-file.toml", "content.txt"), "Unexpected directory.\n");
    write(join(projectDir, ".claude", "AGENTS.md"), "Existing Claude.\n");
    mkdirSync(userHome, { recursive: true });

    await expect(
      runInstall({
        sourceDir,
        outputDir,
        destBase: projectDir,
        userHome,
        platforms: ["claude", "codex"],
        rebuild: false,
        logger: silentLogger,
      }),
    ).rejects.toThrow("Expected generated file");

    expect(read(join(projectDir, ".claude", "AGENTS.md"))).toBe("Existing Claude.\n");
  });

  it("aborts before mutation when a stale agent path was replaced by a directory", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const generatedAgent = join(outputDir, "codex", "agents", "managed.toml");
    write(join(outputDir, "claude", "AGENTS.md"), "Generated Claude.\n");
    write(generatedAgent, "Generated Codex.\n");
    mkdirSync(userHome, { recursive: true });
    const common = { sourceDir, outputDir, destBase: projectDir, userHome, rebuild: false, logger: silentLogger };
    await runInstall({ ...common, platforms: ["codex"] });
    rmSync(generatedAgent);
    rmSync(join(projectDir, ".codex", "agents", "managed.toml"));
    write(join(projectDir, ".codex", "agents", "managed.toml", "local.txt"), "Unmanaged content.\n");
    write(join(projectDir, ".claude", "AGENTS.md"), "Existing Claude.\n");

    await expect(runInstall({ ...common, platforms: ["claude", "codex"] })).rejects.toThrow("Unsafe managed file");

    expect(read(join(projectDir, ".claude", "AGENTS.md"))).toBe("Existing Claude.\n");
    expect(read(join(projectDir, ".codex", "agents", "managed.toml", "local.txt"))).toBe("Unmanaged content.\n");
  });

  it("--no-prune retains a stale type-changed path and relinquishes ownership", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const generatedAgent = join(outputDir, "codex", "agents", "managed.toml");
    write(generatedAgent, "Generated Codex.\n");
    mkdirSync(userHome, { recursive: true });
    const options = {
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["codex"] as const,
      rebuild: false,
      logger: silentLogger,
    };
    await runInstall(options);
    rmSync(generatedAgent);
    rmSync(join(projectDir, ".codex", "agents", "managed.toml"));
    write(join(projectDir, ".codex", "agents", "managed.toml", "local.txt"), "Retained content.\n");

    await runInstall({ ...options, prune: false });

    expect(read(join(projectDir, ".codex", "agents", "managed.toml", "local.txt"))).toBe("Retained content.\n");
    expect(JSON.parse(read(join(projectDir, ".codex", ".ulis-manifest.json"))).agents).toEqual([]);
  });

  it("reserves the ownership manifest filename from generated raw output", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const copiedEntries: string[] = [];
    const logger: Logger = {
      ...silentLogger,
      success(message) {
        copiedEntries.push(message);
      },
    };
    const injected = JSON.stringify({ version: 999, agents: ["agents/victim.md"], skills: [] });
    for (const platform of ["claude", "codex", "opencode"] as const) {
      write(join(outputDir, platform, ".ulis-manifest.json"), injected);
    }
    write(join(outputDir, "cursor", ".ULIS-MANIFEST.JSON"), injected);
    createForgecodeOutput(outputDir);
    write(join(outputDir, "forgecode", ".ulis-manifest.json"), injected);
    write(join(outputDir, "forgecode", ".forge", ".ulis-manifest.json"), injected);
    mkdirSync(userHome, { recursive: true });

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["claude", "codex", "cursor", "opencode", "forgecode"],
      rebuild: false,
      logger,
    });

    for (const configDir of [".claude", ".codex", ".cursor", ".opencode", ".forge"]) {
      const manifest = JSON.parse(read(join(projectDir, configDir, ".ulis-manifest.json")));
      expect(manifest).toEqual({
        version: 3,
        agents: [],
        skills: [],
        rootEntries: expect.any(Array),
      });
      // Never copied, so never claimed: a manifest that lists a file the install did not put there
      // is a false ownership record even when nothing acts on it.
      expect(manifest.rootEntries).not.toContain(".ulis-manifest.json");
    }
    expect(copiedEntries).not.toContain(".ulis-manifest.json");
    expect(copiedEntries).not.toContain(".ULIS-MANIFEST.JSON");
  });

  it("aborts first adoption before a managed namespace junction can receive generated output", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const outsideAgents = join(root, "outside-agents");
    write(join(outputDir, "claude", "AGENTS.md"), "Generated Claude.\n");
    write(join(outputDir, "codex", "agents", "managed.toml"), "Generated Codex.\n");
    write(join(projectDir, ".claude", "AGENTS.md"), "Existing Claude.\n");
    mkdirSync(outsideAgents, { recursive: true });
    mkdirSync(join(projectDir, ".codex"), { recursive: true });
    symlinkSync(outsideAgents, join(projectDir, ".codex", "agents"), process.platform === "win32" ? "junction" : "dir");
    mkdirSync(userHome, { recursive: true });

    await expect(
      runInstall({
        sourceDir,
        outputDir,
        destBase: projectDir,
        userHome,
        platforms: ["claude", "codex"],
        rebuild: false,
        logger: silentLogger,
      }),
    ).rejects.toThrow("symbolic link");

    expect(read(join(projectDir, ".claude", "AGENTS.md"))).toBe("Existing Claude.\n");
    expect(existsSync(join(outsideAgents, "managed.toml"))).toBe(false);
  });

  it("aborts before mutation when a managed namespace resolves outside the platform root", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const outsideAgents = join(root, "outside-agents");
    write(join(outputDir, "claude", "AGENTS.md"), "Generated Claude.\n");
    write(join(outputDir, "codex", "AGENTS.md"), "Generated Codex.\n");
    write(join(projectDir, ".claude", "AGENTS.md"), "Existing Claude.\n");
    write(join(outsideAgents, "managed.toml"), "Outside agent.\n");
    mkdirSync(join(projectDir, ".codex"), { recursive: true });
    symlinkSync(outsideAgents, join(projectDir, ".codex", "agents"), process.platform === "win32" ? "junction" : "dir");
    write(
      join(projectDir, ".codex", ".ulis-manifest.json"),
      JSON.stringify({ version: 1, agents: ["agents/managed.toml"], skills: [] }),
    );
    mkdirSync(userHome, { recursive: true });

    await expect(
      runInstall({
        sourceDir,
        outputDir,
        destBase: projectDir,
        userHome,
        platforms: ["claude", "codex"],
        rebuild: false,
        logger: silentLogger,
      }),
    ).rejects.toThrow("Unsafe managed path");

    expect(read(join(projectDir, ".claude", "AGENTS.md"))).toBe("Existing Claude.\n");
    expect(read(join(outsideAgents, "managed.toml"))).toBe("Outside agent.\n");
  });

  for (const [caseName, manifest] of [
    ["malformed JSON", "{"],
    ["a future version", JSON.stringify({ version: 4, agents: [], skills: [], rootEntries: [] })],
    ["path traversal", JSON.stringify({ version: 1, agents: ["agents/../../outside.md"], skills: [] })],
    ["root traversal", JSON.stringify({ version: 2, agents: [], skills: [], rootEntries: ["../outside"] })],
  ] as const) {
    it(`aborts every selected platform before mutation when a manifest has ${caseName}`, async () => {
      const root = createTempRoot();
      const sourceDir = join(root, ".ulis");
      const outputDir = join(sourceDir, "generated");
      const projectDir = join(root, "project");
      const userHome = join(root, "home");
      write(join(outputDir, "claude", "AGENTS.md"), "Generated Claude.\n");
      write(join(outputDir, "codex", "AGENTS.md"), "Generated Codex.\n");
      write(join(projectDir, ".claude", "AGENTS.md"), "Existing Claude.\n");
      write(join(projectDir, ".codex", ".ulis-manifest.json"), manifest);
      mkdirSync(userHome, { recursive: true });

      await expect(
        runInstall({
          sourceDir,
          outputDir,
          destBase: projectDir,
          userHome,
          platforms: ["claude", "codex"],
          rebuild: false,
          logger: silentLogger,
        }),
      ).rejects.toThrow();

      expect(read(join(projectDir, ".claude", "AGENTS.md"))).toBe("Existing Claude.\n");
      expect(existsSync(join(projectDir, ".claude", ".ulis-manifest.json"))).toBe(false);
    });
  }

  it("rejects a future ownership manifest version during preflight", () => {
    const root = createTempRoot();
    const outputDir = join(root, ".ulis", "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const manifestPath = join(projectDir, ".claude", ".ulis-manifest.json");
    write(manifestPath, JSON.stringify({ version: 4, agents: [], skills: [], rootEntries: [] }));

    const preflight = () => preflightOwnership(["claude"], outputDir, projectDir, userHome, true);

    expect(preflight).toThrow(InstallError);
    expect(preflight).toThrow(
      `Unsupported ULIS ownership manifest for claude at ${manifestPath}: expected version 1, 2 or 3, received 4`,
    );
  });
});
