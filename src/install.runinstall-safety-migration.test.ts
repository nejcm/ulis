import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { runBuild, type Logger } from "./build.js";
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

// runInstall: destination symlink/backup/dir-file conflict safety, plus ownership-manifest v1/v2/v3
// migration and legacy-home warnings - two themes stapled together; a few tests here read as
// ownership or opencode-roots material instead.
describe("runInstall", () => {
  // `agents` and `skills` are created by the install rather than merged into, and `ensureDir` used
  // `mkdir -p`, which accepts a symlink already sitting at the path. Everything the named-directory
  // copy then does - the category directories, the removals, the writes - lands beyond the link.
  // Preflight refuses a symlinked managed path, but only walks paths that are in the current managed
  // set: a category directory that generates no files is never walked, and neither is one planted
  // after preflight has run.
  it("refuses to create a named directory through a symlink in the destination", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const outside = join(root, "outside");
    mkdirSync(userHome, { recursive: true });
    mkdirSync(outside, { recursive: true });
    mkdirSync(join(outputDir, "opencode", "agents", "core"), { recursive: true });
    mkdirSync(join(outputDir, "opencode", "agents", "specialized"), { recursive: true });
    write(join(outputDir, "opencode", "AGENTS.md"), "Generated instructions.\n");
    mkdirSync(join(projectDir, ".opencode"), { recursive: true });
    symlinkSync(outside, join(projectDir, ".opencode", "agents"), "dir");

    let thrown: unknown;
    try {
      await runInstall({
        sourceDir,
        outputDir,
        destBase: projectDir,
        userHome,
        platforms: ["opencode"],
        rebuild: false,
        logger: silentLogger,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(InstallError);
    expect((thrown as Error).message).toBe(
      `Refusing to install through a symbolic link: ${join(projectDir, ".opencode", "agents")}`,
    );
    expect(readdirSync(outside)).toEqual([]);
  });

  // A backup that deletes the previous backup is the opposite of the feature. The name carries a
  // second-granularity timestamp, so two installs a few milliseconds apart compute the same path -
  // and the copy that gets destroyed is the older one, holding the state furthest from whatever the
  // installs have been doing to the destination.
  it("keeps an earlier backup when a second --backup install lands in the same second", async () => {
    const currentSecond = () => Math.floor(Date.now() / 1000);
    let sameSecond = false;
    let backups: string[] = [];
    let projectDir = "";

    // Retried only to guarantee the precondition the case needs, then asserted below: a run that
    // straddled a second boundary would produce two names for unrelated reasons and prove nothing.
    for (let attempt = 0; attempt < 20 && !sameSecond; attempt += 1) {
      const root = createTempRoot();
      const sourceDir = join(root, ".ulis");
      const outputDir = join(sourceDir, "generated");
      projectDir = join(root, "project");
      const userHome = join(root, "home");
      mkdirSync(userHome, { recursive: true });
      write(join(outputDir, "opencode", "AGENTS.md"), "Generated instructions.\n");
      write(join(projectDir, ".opencode", "keep.md"), "Original.\n");
      const options = {
        sourceDir,
        outputDir,
        destBase: projectDir,
        userHome,
        platforms: ["opencode"] as const,
        rebuild: false,
        backup: true,
        logger: silentLogger,
      };

      const startedAt = currentSecond();
      await runInstall(options);
      await runInstall(options);
      sameSecond = startedAt === currentSecond();
      backups = readdirSync(projectDir).filter((entry) => entry.startsWith(".opencode.") && entry.endsWith(".backup"));
    }

    expect(sameSecond).toBe(true);
    expect(backups).toHaveLength(2);
    for (const backup of backups) {
      expect(read(join(projectDir, backup, "keep.md"))).toBe("Original.\n");
    }
  });

  // The generated set changing a name from a directory to a file must not take the directory's
  // contents with it. The sweep deliberately keeps descendants a previous install never recorded,
  // and a recursive removal here would destroy exactly the files it had just saved.
  it("refuses to replace a destination directory with a generated file of the same name", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const installedCommands = join(projectDir, ".opencode", "commands");
    mkdirSync(userHome, { recursive: true });
    write(join(outputDir, "opencode", "commands"), "Now a file.\n");
    write(join(installedCommands, "mine.md"), "Mine.\n");

    let thrown: unknown;
    try {
      await runInstall({
        sourceDir,
        outputDir,
        destBase: projectDir,
        userHome,
        platforms: ["opencode"],
        rebuild: false,
        logger: silentLogger,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(InstallError);
    expect(read(join(installedCommands, "mine.md"))).toBe("Mine.\n");
  });

  // The build merges each `raw/` layer into the generated tree in turn. If the first layer puts a
  // symlink there, the second reads and writes through it - so a remote source can have the build
  // modify a file outside the generated tree entirely, after the trust prompt has been answered.
  it("keeps a raw merge inside the generated tree when an earlier layer left a symlink", () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(root, "generated");
    const externalPath = join(root, "outside", "external.json");
    write(sourceDir + "/config.yaml", "version: 1\nname: test\n");
    write(externalPath, JSON.stringify({ untouched: true }));
    mkdirSync(join(sourceDir, "raw", "all"), { recursive: true });
    symlinkSync(externalPath, join(sourceDir, "raw", "all", "config.json"));
    write(join(sourceDir, "raw", "claude", "config.json"), JSON.stringify({ injected: true }));

    runBuild({ targets: ["claude"], sourceDir, outputDir, logger: silentLogger });

    expect(readFileSync(externalPath, "utf-8")).toBe(JSON.stringify({ untouched: true }));
    const generatedConfig = join(outputDir, "claude", "config.json");
    expect(lstatSync(generatedConfig).isSymbolicLink()).toBe(false);
    expect(JSON.parse(read(generatedConfig))).toEqual({ injected: true });
  });

  // Root entries describe what lands in the destination root. For ForgeCode that is the native
  // root plus the outer tree, never the generated directory's own listing - and never a reserved
  // name the install skips on the way in.
  it("records ForgeCode root entries from the destination's own roots", () => {
    const root = createTempRoot();
    const outputDir = join(root, "generated");
    createForgecodeOutput(outputDir);
    write(join(outputDir, "forgecode", ".forge", "commands", "review.md"), "Review.\n");
    write(join(outputDir, "forgecode", ".ulis-provenance.json"), JSON.stringify({ remoteSources: [] }));

    const ownership = preflightOwnership(["forgecode"], outputDir, join(root, "project"), join(root, "home"), true);

    expect(ownership.get("forgecode")!.current.rootEntries).toEqual([".mcp.json", "AGENTS.md", "commands/review.md"]);
  });

  // A version 2 manifest recorded top-level *names*. A name that is a file was recorded by a previous
  // install as its own generated output, so pruning it on the first upgraded run is the stale cleanup
  // working; a name that is a *directory* may have gained files the user put there since, which is
  // what the empty-only safeguard is for. The CHANGELOG says exactly this.
  it("migrates a v2 manifest to v3, pruning a stale file but not a directory with content", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const targetDir = join(projectDir, ".opencode");
    mkdirSync(userHome, { recursive: true });
    write(join(outputDir, "opencode", "AGENTS.md"), "Generated instructions.\n");
    write(join(targetDir, "stale.md"), "Stale command.\n");
    write(join(targetDir, "commands", "mine.md"), "Mine.\n");
    // A version 2 manifest records top-level names, not files.
    write(
      join(targetDir, ".ulis-manifest.json"),
      JSON.stringify({ version: 2, agents: [], skills: [], rootEntries: ["stale.md", "commands"] }),
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

    expect(existsSync(join(targetDir, "stale.md"))).toBe(false);
    expect(read(join(targetDir, "commands", "mine.md"))).toBe("Mine.\n");
    expect(JSON.parse(read(join(targetDir, ".ulis-manifest.json")))).toMatchObject({ version: 3 });
  });

  it("migrates a v1 manifest without sweeping OpenCode root entries", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const targetDir = join(projectDir, ".opencode");
    mkdirSync(userHome, { recursive: true });
    write(join(outputDir, "opencode", "AGENTS.md"), "Generated instructions.\n");
    write(join(targetDir, "commands", "old.md"), "Old command.\n");
    write(join(targetDir, ".ulis-manifest.json"), JSON.stringify({ version: 1, agents: [], skills: [] }));

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["opencode"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(read(join(targetDir, "commands", "old.md"))).toBe("Old command.\n");
    expect(JSON.parse(read(join(targetDir, ".ulis-manifest.json")))).toMatchObject({
      version: 3,
      rootEntries: ["AGENTS.md"],
    });
  });

  it("does not warn about legacy home directories during a project install", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    const warnings: string[] = [];
    write(join(outputDir, "opencode", "AGENTS.md"), "Generated instructions.\n");
    write(join(userHome, "opencode", ".ulis-manifest.json"), JSON.stringify({ version: 1, agents: [], skills: [] }));

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["opencode"],
      rebuild: false,
      logger: {
        ...silentLogger,
        warn(message) {
          warnings.push(message);
        },
      },
    });

    expect(warnings).toEqual([]);
  });

  it("installs OpenCode globally into .config without touching legacy or unmanaged entries", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const userHome = join(root, "home");
    const targetDir = join(userHome, ".config", "opencode");
    const warnings: string[] = [];
    const logger: Logger = {
      ...silentLogger,
      warn(message) {
        warnings.push(message);
      },
    };
    write(join(outputDir, "opencode", "AGENTS.md"), "Generated instructions.\n");
    write(join(targetDir, "unmanaged.txt"), "Keep target.\n");
    for (const legacyDir of [join(userHome, "opencode"), join(userHome, ".opencode")]) {
      write(join(legacyDir, "unmanaged.txt"), "Keep legacy.\n");
    }
    const options = {
      sourceDir,
      outputDir,
      destBase: userHome,
      userHome,
      globalInstall: true,
      platforms: ["opencode"] as const,
      rebuild: false,
      logger,
    };
    await runInstall(options);
    expect(warnings).toEqual([]);
    for (const legacyDir of [join(userHome, "opencode"), join(userHome, ".opencode")]) {
      write(join(legacyDir, ".ulis-manifest.json"), JSON.stringify({ version: 1, agents: [], skills: [] }));
    }
    await runInstall({ ...options, prune: false });
    write(join(targetDir, "commands", "old.md"), "Keep v1 entry.\n");
    write(join(targetDir, ".ulis-manifest.json"), JSON.stringify({ version: 1, agents: [], skills: [] }));
    await runInstall(options);

    expect(read(join(targetDir, "AGENTS.md"))).toBe("Generated instructions.\n");
    expect(read(join(targetDir, "unmanaged.txt"))).toBe("Keep target.\n");
    expect(read(join(targetDir, "commands", "old.md"))).toBe("Keep v1 entry.\n");
    expect(read(join(userHome, "opencode", "unmanaged.txt"))).toBe("Keep legacy.\n");
    expect(read(join(userHome, ".opencode", "unmanaged.txt"))).toBe("Keep legacy.\n");
    expect(warnings.some((message) => message.includes(join(userHome, "opencode")))).toBe(true);
    expect(warnings.some((message) => message.includes(join(userHome, ".opencode")))).toBe(true);
  });
});
