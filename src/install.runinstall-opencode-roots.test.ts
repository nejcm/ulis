import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { __test, runInstall } from "./install.js";
import { InstallError } from "./install/errors.js";
import { cleanupInstallTempRoots, createTempRoot, read, silentLogger, write } from "./test-utils/install.js";

afterEach(() => {
  __test.resetRuntimeDependencies();
  cleanupInstallTempRoots();
});

// runInstall: OpenCode root-entry pruning/sweep and destination symlink safety for root writes.
// The first test ("backs up the ownership manifest...") is generic Claude backup-before-prune
// coverage, not OpenCode-specific.
describe("runInstall", () => {
  it("backs up the ownership manifest and stale entries before pruning", async () => {
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
    await runInstall({ ...options, backup: true });

    const backupName = readdirSync(projectDir).find(
      (entry) => entry.startsWith(".claude.") && entry.endsWith(".backup"),
    );
    expect(backupName).toBeDefined();
    expect(existsSync(join(projectDir, backupName!, ".ulis-manifest.json"))).toBe(true);
    expect(existsSync(join(projectDir, backupName!, "agents", "managed.md"))).toBe(true);
  });

  for (const prune of [true, false]) {
    it(`${prune ? "prunes" : "keeps"} agents a previous install managed under the legacy OpenCode category dirs`, async () => {
      const root = createTempRoot();
      const sourceDir = join(root, ".ulis");
      const outputDir = join(sourceDir, "generated");
      const projectDir = join(root, "project");
      const userHome = join(root, "home");
      const agentsDir = join(projectDir, ".opencode", "agents");
      mkdirSync(sourceDir, { recursive: true });
      mkdirSync(userHome, { recursive: true });

      write(join(outputDir, "opencode", "agents", "worker.md"), "Generated worker.\n");
      write(join(agentsDir, "core", "worker.md"), "Old core worker.\n");
      write(join(agentsDir, "core", "local.md"), "Local core agent.\n");
      write(join(agentsDir, "specialized", "reviewer.md"), "Old specialized reviewer.\n");
      write(join(agentsDir, "specialized", "local.md"), "Local specialized agent.\n");
      write(
        join(projectDir, ".opencode", ".ulis-manifest.json"),
        JSON.stringify({
          version: 3,
          agents: ["agents/core/worker.md", "agents/specialized/reviewer.md"],
          skills: [],
          rootEntries: [],
        }),
      );

      await runInstall({
        sourceDir,
        outputDir,
        destBase: projectDir,
        userHome,
        platforms: ["opencode"],
        rebuild: false,
        prune,
        logger: silentLogger,
      });

      expect(read(join(agentsDir, "worker.md"))).toBe("Generated worker.\n");
      expect(existsSync(join(agentsDir, "core", "worker.md"))).toBe(!prune);
      expect(existsSync(join(agentsDir, "specialized", "reviewer.md"))).toBe(!prune);
      expect(read(join(agentsDir, "core", "local.md"))).toBe("Local core agent.\n");
      expect(read(join(agentsDir, "specialized", "local.md"))).toBe("Local specialized agent.\n");
      expect(JSON.parse(read(join(projectDir, ".opencode", ".ulis-manifest.json"))).agents).toEqual([
        "agents/worker.md",
      ]);
    });
  }

  it("preserves unmanaged OpenCode root entries when no prior manifest exists", async () => {
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
    expect(existsSync(join(projectDir, ".opencode", "commands", "old.md"))).toBe(true);
    expect(existsSync(join(projectDir, ".opencode", "docs", "old.md"))).toBe(true);
    expect(read(join(projectDir, ".opencode", "agents", "specialized", "local.md"))).toBe("Local agent.\n");
    expect(read(join(projectDir, ".opencode", "skills", "local", "SKILL.md"))).toBe("Local skill.\n");
  });

  it("prunes OpenCode root entries listed by the previous install's manifest", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const generatedCommands = join(outputDir, "opencode", "commands");
    mkdirSync(userHome, { recursive: true });
    write(join(generatedCommands, "old.md"), "Old command.\n");
    const options = {
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["opencode"] as const,
      rebuild: false,
      logger: silentLogger,
    };
    await runInstall(options);
    rmSync(generatedCommands, { recursive: true });
    write(join(outputDir, "opencode", "AGENTS.md"), "Generated instructions.\n");

    await runInstall(options);

    expect(existsSync(join(projectDir, ".opencode", "commands"))).toBe(false);
  });

  it("--no-prune retains OpenCode root entries listed by the previous install's manifest", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const generatedCommands = join(outputDir, "opencode", "commands");
    mkdirSync(userHome, { recursive: true });
    write(join(generatedCommands, "old.md"), "Old command.\n");
    const options = {
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["opencode"] as const,
      rebuild: false,
      logger: silentLogger,
    };
    await runInstall(options);
    rmSync(generatedCommands, { recursive: true });
    write(join(outputDir, "opencode", "AGENTS.md"), "Generated instructions.\n");

    await runInstall({ ...options, prune: false });

    expect(read(join(projectDir, ".opencode", "commands", "old.md"))).toBe("Old command.\n");
  });

  // The sweep records what a previous install wrote. A directory it wrote may since have gained
  // files the user put there, which were never ULIS's to remove - so the sweep has to work at the
  // granularity it records, not remove the whole subtree by name.
  it("sweeps only the files a previous install wrote into an OpenCode root directory", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const generatedCommands = join(outputDir, "opencode", "commands");
    mkdirSync(userHome, { recursive: true });
    write(join(generatedCommands, "old.md"), "Old command.\n");
    const options = {
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["opencode"] as const,
      rebuild: false,
      logger: silentLogger,
    };
    await runInstall(options);
    write(join(projectDir, ".opencode", "commands", "mine.md"), "Mine.\n");
    rmSync(generatedCommands, { recursive: true });
    write(join(outputDir, "opencode", "AGENTS.md"), "Generated instructions.\n");

    await runInstall(options);

    expect(read(join(projectDir, ".opencode", "commands", "mine.md"))).toBe("Mine.\n");
    expect(existsSync(join(projectDir, ".opencode", "commands", "old.md"))).toBe(false);
  });

  // The copy pass has the same problem from the other side: replacing a generated root directory
  // wholesale removes whatever the user added next to its files.
  it("merges a regenerated root directory instead of replacing the destination's", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(userHome, { recursive: true });
    write(join(outputDir, "opencode", "commands", "old.md"), "Old command.\n");
    const options = {
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["opencode"] as const,
      rebuild: false,
      logger: silentLogger,
    };
    await runInstall(options);
    write(join(projectDir, ".opencode", "commands", "mine.md"), "Mine.\n");

    await runInstall(options);

    expect(read(join(projectDir, ".opencode", "commands", "mine.md"))).toBe("Mine.\n");
    expect(read(join(projectDir, ".opencode", "commands", "old.md"))).toBe("Old command.\n");
  });

  // Merging into an existing destination directory means the copy now walks a tree the user
  // controls. `cpSync` follows a symlink it finds there, so a link planted anywhere below the
  // platform root would relocate the write outside it - the write-side twin of the traversal the
  // sweep refuses. Replacing the link is safe: `rmSync` removes the link, never its target.
  it("refuses to write through a nested symlink in the destination", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const outside = join(root, "outside");
    mkdirSync(userHome, { recursive: true });
    write(join(outside, "victim.md"), "Victim.\n");
    write(join(outputDir, "opencode", "commands", "nested", "payload.md"), "Payload.\n");
    write(join(projectDir, ".opencode", "commands", "keep.md"), "Keep.\n");
    symlinkSync(outside, join(projectDir, ".opencode", "commands", "nested"), "dir");

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["opencode"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(readdirSync(outside)).toEqual(["victim.md"]);
    const nested = join(projectDir, ".opencode", "commands", "nested");
    expect(lstatSync(nested).isSymbolicLink()).toBe(false);
    expect(read(join(nested, "payload.md"))).toBe("Payload.\n");
    expect(read(join(projectDir, ".opencode", "commands", "keep.md"))).toBe("Keep.\n");
  });

  // Case-folding the managed-path comparison makes a case-only rename look like the same entry, so
  // the sweep skips the old file while the copy writes the new one beside it - and on a
  // case-sensitive filesystem the stale command stays live in the destination.
  it("prunes a root entry renamed by case alone", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const upper = join(outputDir, "opencode", "commands", "Old.md");
    const lower = join(outputDir, "opencode", "commands", "old.md");
    mkdirSync(userHome, { recursive: true });
    write(upper, "Upper name.\n");
    const options = {
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["opencode"] as const,
      rebuild: false,
      logger: silentLogger,
    };

    await runInstall(options);
    renameSync(upper, lower);
    write(lower, "Lower name.\n");
    await runInstall(options);

    const installed = readdirSync(join(projectDir, ".opencode", "commands"));
    expect(installed).toEqual(["old.md"]);
    expect(read(join(projectDir, ".opencode", "commands", "old.md"))).toBe("Lower name.\n");
    expect(JSON.parse(read(join(projectDir, ".opencode", ".ulis-manifest.json"))).rootEntries).toEqual([
      "commands/old.md",
    ]);
  });

  // Ownership is rewritten at the end of every install, so a sweep that cannot see a recorded path
  // must not conclude the path is gone. Treating an inspection failure as "not there" skips the
  // stale file *and* drops it from the new manifest, which turns a live managed command into one
  // nothing will ever clean up again - fail-open, on the deletion path, permanently.
  it("aborts rather than disowning a root entry it cannot inspect", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const generatedCommands = join(outputDir, "opencode", "commands");
    const installedCommands = join(projectDir, ".opencode", "commands");
    const manifestPath = join(projectDir, ".opencode", ".ulis-manifest.json");
    mkdirSync(userHome, { recursive: true });
    write(join(generatedCommands, "old.md"), "Old command.\n");
    const options = {
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["opencode"] as const,
      rebuild: false,
      logger: silentLogger,
    };

    await runInstall(options);
    rmSync(generatedCommands, { recursive: true });
    write(join(outputDir, "opencode", "AGENTS.md"), "Generated instructions.\n");
    // Not searchable: `lstat` on the directory itself still succeeds, on anything inside it does not.
    chmodSync(installedCommands, 0o000);

    let thrown: unknown;
    try {
      await runInstall(options);
    } catch (error) {
      thrown = error;
    } finally {
      chmodSync(installedCommands, 0o755);
    }

    expect(thrown).toBeInstanceOf(InstallError);
    expect((thrown as Error).message).toBe(`Failed to inspect managed path: ${join(installedCommands, "old.md")}`);
    // The point of aborting: ownership still names the file, so a later install can still remove it.
    expect(JSON.parse(read(manifestPath)).rootEntries).toEqual(["commands/old.md"]);
    expect(read(join(installedCommands, "old.md"))).toBe("Old command.\n");
  });

  // The identity fallback exists for one thing: a case-insensitive destination, where two spellings
  // are one directory entry. A symlink resolves to the same `realpath` without being the same entry,
  // so accepting it there preserves the stale file, lets the copy replace the link, and then drops
  // the old path from the manifest - leaving a live file nothing owns.
  it("does not treat a symlinked alias as the entry it points at", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const generatedCommands = join(outputDir, "opencode", "commands");
    const installedCommands = join(projectDir, ".opencode", "commands");
    mkdirSync(userHome, { recursive: true });
    write(join(generatedCommands, "old.md"), "Old command.\n");
    const options = {
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["opencode"] as const,
      rebuild: false,
      logger: silentLogger,
    };

    await runInstall(options);
    rmSync(join(generatedCommands, "old.md"));
    write(join(generatedCommands, "new.md"), "New command.\n");
    symlinkSync("old.md", join(installedCommands, "new.md"));

    await runInstall(options);

    expect(readdirSync(installedCommands)).toEqual(["new.md"]);
    expect(lstatSync(join(installedCommands, "new.md")).isSymbolicLink()).toBe(false);
    expect(read(join(installedCommands, "new.md"))).toBe("New command.\n");
  });
});
