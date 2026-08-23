import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { runBuild, type Logger } from "./build.js";
import { __test, runInstall } from "./install.js";
import { InstallError } from "./install/errors.js";
import { platformConfigDir, PLATFORMS } from "./platforms.js";
import { cleanupInstallTempRoots, createTempRoot, read, silentLogger, write } from "./test-utils/install.js";

afterEach(() => {
  __test.resetRuntimeDependencies();
  cleanupInstallTempRoots();
});

describe("cross-run remote provenance", () => {
  function writeMinimalSource(dir: string, name: string): void {
    write(join(dir, "config.yaml"), `version: 1\nname: ${name}\n`);
  }

  it("refuses `install --skip-rebuild` against a tree a prior remote build produced", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const presetDir = join(root, "preset");
    const outputDir = join(sourceDir, "generated");
    writeMinimalSource(sourceDir, "base");
    writeMinimalSource(presetDir, "preset");

    runBuild({
      sourceDir,
      outputDir,
      targets: ["codex"],
      logger: silentLogger,
      presets: [{ name: "team", dir: presetDir, remoteUrl: "https://github.com/o/r" }],
    });
    expect(existsSync(join(outputDir, "codex", ".ulis-provenance.json"))).toBe(true);

    const projectDir = join(root, "project");
    mkdirSync(projectDir, { recursive: true });

    const install = runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome: join(root, "home"),
      platforms: ["codex"],
      rebuild: false,
      logger: silentLogger,
    });
    await expect(install).rejects.toBeInstanceOf(InstallError);
    await expect(install).rejects.toThrow(
      "This generated tree was built from https://github.com/o/r; re-run `ulis install --preset https://github.com/o/r` " +
        "so the commands can be reviewed against a fresh build. Recorded for: codex.",
    );
    expect(existsSync(join(projectDir, ".codex"))).toBe(false);
  });

  it("writes remote source URLs in sorted order", () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const presetDir = join(root, "preset");
    const outputDir = join(sourceDir, "generated");
    writeMinimalSource(sourceDir, "base");
    writeMinimalSource(presetDir, "preset");
    const presets = [
      { name: "z", dir: presetDir, remoteUrl: "https://github.com/z/r" },
      { name: "a", dir: presetDir, remoteUrl: "https://github.com/a/r" },
    ];

    runBuild({ sourceDir, outputDir, targets: ["codex"], logger: silentLogger, presets });

    const marker = JSON.parse(read(join(outputDir, "codex", ".ulis-provenance.json"))) as {
      remoteSources: readonly string[];
    };
    expect(marker.remoteSources).toEqual(["https://github.com/a/r", "https://github.com/z/r"]);
  });

  // The marker lives inside the untouched platform directory, so rebuilding another platform
  // cannot erase it.
  it("a narrow local rebuild does not erase the record for a platform it left untouched", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const presetDir = join(root, "preset");
    const outputDir = join(sourceDir, "generated");
    writeMinimalSource(sourceDir, "base");
    write(join(presetDir, "config.yaml"), "version: 1\nname: preset\n");
    write(join(presetDir, "raw", "claude", "EVIL.md"), "evil payload\n");

    // 1. `ulis build --preset <url>` across every platform.
    runBuild({
      sourceDir,
      outputDir,
      logger: silentLogger,
      presets: [{ name: "team", dir: presetDir, remoteUrl: "https://github.com/o/evil" }],
    });
    expect(existsSync(join(outputDir, "claude", "EVIL.md"))).toBe(true);

    // 2. `ulis install --target codex` (or `build --target codex`): purely local, narrow rebuild.
    runBuild({ sourceDir, outputDir, targets: ["codex"], logger: silentLogger });
    // The claude payload from step 1 is untouched - "codex" was never asked to clean it.
    expect(existsSync(join(outputDir, "claude", "EVIL.md"))).toBe(true);
    // Its marker lives in the untouched platform tree. Rebuilding Codex only removed Codex's own.
    const markerAfterNarrowRebuild = JSON.parse(read(join(outputDir, "claude", ".ulis-provenance.json"))) as {
      remoteSources: readonly string[];
    };
    expect(markerAfterNarrowRebuild.remoteSources).toEqual(["https://github.com/o/evil"]);
    expect(existsSync(join(outputDir, "codex", ".ulis-provenance.json"))).toBe(false);

    const projectDir = join(root, "project");
    mkdirSync(projectDir, { recursive: true });

    // 3. `ulis install --skip-rebuild` against "claude" must still refuse.
    const install = runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome: join(root, "home"),
      platforms: ["claude"],
      rebuild: false,
      logger: silentLogger,
    });
    await expect(install).rejects.toBeInstanceOf(InstallError);
    await expect(install).rejects.toThrow(/https:\/\/github\.com\/o\/evil/u);
    expect(existsSync(join(projectDir, ".claude"))).toBe(false);
  });

  it("a purely local rebuild clears a previously written provenance record", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const presetDir = join(root, "preset");
    const outputDir = join(sourceDir, "generated");
    writeMinimalSource(sourceDir, "base");
    writeMinimalSource(presetDir, "preset");

    runBuild({
      sourceDir,
      outputDir,
      targets: ["codex"],
      logger: silentLogger,
      presets: [{ name: "team", dir: presetDir, remoteUrl: "https://github.com/o/r" }],
    });
    expect(existsSync(join(outputDir, "codex", ".ulis-provenance.json"))).toBe(true);

    runBuild({ sourceDir, outputDir, targets: ["codex"], logger: silentLogger });
    expect(existsSync(join(outputDir, "codex", ".ulis-provenance.json"))).toBe(false);

    const projectDir = join(root, "project");
    mkdirSync(projectDir, { recursive: true });
    const platforms = await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome: join(root, "home"),
      platforms: ["codex"],
      rebuild: false,
      logger: silentLogger,
    });
    expect(platforms).toEqual(["codex"]);
    expect(existsSync(join(projectDir, ".codex"))).toBe(true);
  });

  it("still gates normally when `install --preset <remote>` resolves the same source live, replacing a stale record", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const presetDir = join(root, "preset");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    writeMinimalSource(sourceDir, "base");
    writeMinimalSource(presetDir, "preset");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    mkdirSync(outputDir, { recursive: true });
    // A stale record from an unrelated prior remote build must not itself trigger the refusal, and
    // must be replaced - not merely dropped - once this run's own live remote preset rebuilds "codex".
    write(
      join(outputDir, "codex", ".ulis-provenance.json"),
      JSON.stringify({ version: 1, remoteSources: ["https://github.com/o/stale"] }),
    );

    const questions: string[] = [];
    __test.setRuntimeDependencies({
      runCommand: () => ({ status: 0, stdout: "", stderr: "" }) as never,
      async runAsyncCommand() {
        return { status: 0, stdout: "", stderr: "" };
      },
      async confirm(question) {
        questions.push(question);
        return true;
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
      presets: [{ name: "team", dir: presetDir, remoteUrl: "https://github.com/o/r" }],
      remoteSources: ["https://github.com/o/r"],
    });

    expect(questions).toEqual(["Install from this remote source?"]);
    expect(existsSync(join(projectDir, ".codex"))).toBe(true);
    // Replaced, not merely dropped: the record now names this run's own live preset for "codex".
    const marker = JSON.parse(read(join(outputDir, "codex", ".ulis-provenance.json"))) as {
      remoteSources: readonly string[];
    };
    expect(marker.remoteSources).toEqual(["https://github.com/o/r"]);
  });

  it("a purely local build writes no record, and install prompts for nothing", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    writeMinimalSource(sourceDir, "base");

    runBuild({ sourceDir, outputDir, targets: ["codex"], logger: silentLogger });
    expect(existsSync(join(outputDir, "codex", ".ulis-provenance.json"))).toBe(false);

    const projectDir = join(root, "project");
    mkdirSync(projectDir, { recursive: true });
    const questions: string[] = [];
    __test.setRuntimeDependencies({
      runCommand: () => ({ status: 0, stdout: "", stderr: "" }) as never,
      async runAsyncCommand() {
        return { status: 0, stdout: "", stderr: "" };
      },
      async confirm(question) {
        questions.push(question);
        return true;
      },
    });

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome: join(root, "home"),
      platforms: ["codex"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(questions).toHaveLength(0);
    expect(existsSync(join(projectDir, ".codex"))).toBe(true);
  });

  // An unreadable marker cannot prove its platform was built locally. Treating it as absent would
  // reopen the cross-run bypass through corruption or an interrupted write.
  it("refuses `install --skip-rebuild` when the provenance record exists but cannot be parsed", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    writeMinimalSource(sourceDir, "base");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });
    write(join(outputDir, "codex", ".ulis-provenance.json"), "{ not valid json");

    const install = runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome: join(root, "home"),
      platforms: ["codex"],
      rebuild: false,
      logger: silentLogger,
    });
    await expect(install).rejects.toBeInstanceOf(InstallError);
    await expect(install).rejects.toThrow(/Could not read the provenance record for codex/u);
    expect(existsSync(join(projectDir, ".codex"))).toBe(false);
  });

  // A record naming a future, unrecognised shape is the same "cannot rule this out" case as
  // truncated JSON, just caused by a version bump instead of a crash.
  it("refuses `install --skip-rebuild` when the provenance record is a version this build doesn't understand", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    writeMinimalSource(sourceDir, "base");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });
    write(
      join(outputDir, "codex", ".ulis-provenance.json"),
      JSON.stringify({ version: 2, remoteSources: { codex: ["https://github.com/o/r"] } }),
    );

    const install = runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome: join(root, "home"),
      platforms: ["codex"],
      rebuild: false,
      logger: silentLogger,
    });
    await expect(install).rejects.toBeInstanceOf(InstallError);
    expect(existsSync(join(projectDir, ".codex"))).toBe(false);
  });

  // A top-level array is not a marker object, even when it is empty.
  it("refuses `install --skip-rebuild` when the marker's top level is an array", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    writeMinimalSource(sourceDir, "base");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });
    write(join(outputDir, "codex", ".ulis-provenance.json"), JSON.stringify([]));

    const install = runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome: join(root, "home"),
      platforms: ["codex"],
      rebuild: false,
      logger: silentLogger,
    });
    await expect(install).rejects.toBeInstanceOf(InstallError);
    expect(existsSync(join(projectDir, ".codex"))).toBe(false);
  });

  // POSIX permission bits are bypassed by root, so this test is a no-op under root and on Windows.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "records provenance before generation starts, so a throw partway through a build still protects the platforms it already wrote",
    () => {
      const root = createTempRoot();
      const sourceDir = join(root, ".ulis");
      const presetDir = join(root, "preset");
      const outputDir = join(sourceDir, "generated");
      const restrictedDir = join(outputDir, "codex", "sub");
      writeMinimalSource(sourceDir, "base");
      writeMinimalSource(presetDir, "preset");
      mkdirSync(restrictedDir, { recursive: true });
      write(join(restrictedDir, "f.txt"), "x");
      chmodSync(restrictedDir, 0o555);

      let thrown: unknown;
      try {
        runBuild({
          sourceDir,
          outputDir,
          targets: ["claude", "codex"],
          logger: silentLogger,
          presets: [{ name: "team", dir: presetDir, remoteUrl: "https://github.com/o/evil" }],
        });
      } catch (error) {
        thrown = error;
      } finally {
        if (existsSync(restrictedDir)) chmodSync(restrictedDir, 0o755);
      }

      expect((thrown as NodeJS.ErrnoException | undefined)?.code).toBe("EACCES");
      expect(existsSync(join(outputDir, "claude"))).toBe(true);
      const marker = JSON.parse(read(join(outputDir, "claude", ".ulis-provenance.json"))) as {
        remoteSources: readonly string[];
      };
      expect(marker.remoteSources).toEqual(["https://github.com/o/evil"]);
    },
  );

  it("heals a platform output symlink during a full build", () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const presetDir = join(root, "preset");
    const outputDir = join(sourceDir, "generated");
    writeMinimalSource(sourceDir, "base");
    writeMinimalSource(presetDir, "preset");
    mkdirSync(outputDir, { recursive: true });
    symlinkSync(join(root, "does-not-exist"), join(outputDir, "codex"));

    runBuild({
      sourceDir,
      outputDir,
      logger: silentLogger,
      presets: [{ name: "team", dir: presetDir, remoteUrl: "https://github.com/o/evil" }],
    });

    expect(lstatSync(join(outputDir, "codex")).isDirectory()).toBe(true);
    const marker = JSON.parse(read(join(outputDir, "codex", ".ulis-provenance.json"))) as {
      remoteSources: readonly string[];
    };
    expect(marker.remoteSources).toEqual(["https://github.com/o/evil"]);
  });

  it("refuses a legacy root provenance record before creating a destination", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    writeMinimalSource(sourceDir, "base");
    write(join(outputDir, ".ulis-provenance.json"), "opaque pre-release record");

    const install = runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome: join(root, "home"),
      platforms: ["codex"],
      rebuild: false,
      logger: silentLogger,
    });

    await expect(install).rejects.toBeInstanceOf(InstallError);
    await expect(install).rejects.toThrow(/pre-release build of ULIS/u);
    expect(existsSync(projectDir)).toBe(false);
  });
  it("only a full build removes a legacy root provenance record", () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const legacyPath = join(outputDir, ".ulis-provenance.json");
    writeMinimalSource(sourceDir, "base");
    write(legacyPath, "opaque pre-release record");

    runBuild({ sourceDir, outputDir, targets: ["codex"], logger: silentLogger });
    expect(existsSync(legacyPath)).toBe(true);

    runBuild({ sourceDir, outputDir, logger: silentLogger });
    expect(existsSync(legacyPath)).toBe(false);
  });
  it("never copies platform provenance markers to destinations", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const presetDir = join(root, "preset");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    writeMinimalSource(sourceDir, "base");
    writeMinimalSource(presetDir, "preset");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    const presets = [{ name: "team", dir: presetDir, remoteUrl: "https://github.com/o/r" }];

    runBuild({ sourceDir, outputDir, logger: silentLogger, presets });
    for (const platform of PLATFORMS) {
      expect(existsSync(join(outputDir, platform, ".ulis-provenance.json"))).toBe(true);
    }

    __test.setRuntimeDependencies({
      runCommand: () => ({ status: 0, stdout: "", stderr: "" }) as never,
      async runAsyncCommand() {
        return { status: 0, stdout: "", stderr: "" };
      },
      async confirm() {
        return true;
      },
    });
    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: PLATFORMS,
      rebuild: false,
      logger: silentLogger,
      presets,
      remoteSources: ["https://github.com/o/r"],
    });

    for (const platform of PLATFORMS) {
      expect(existsSync(join(platformConfigDir(platform, projectDir, userHome), ".ulis-provenance.json"))).toBe(false);
    }
    expect(existsSync(join(projectDir, ".ulis-provenance.json"))).toBe(false);
  });
  it("ignores a raw provenance marker and keeps the remote marker armed", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const presetDir = join(root, "preset");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    writeMinimalSource(sourceDir, "base");
    writeMinimalSource(presetDir, "preset");
    write(join(presetDir, "raw", "codex", ".ULIS-PROVENANCE.JSON"), JSON.stringify({ version: 1, remoteSources: [] }));
    const warnings: string[] = [];
    const logger: Logger = { ...silentLogger, warn: (message) => warnings.push(message) };

    runBuild({
      sourceDir,
      outputDir,
      targets: ["codex"],
      logger,
      presets: [{ name: "team", dir: presetDir, remoteUrl: "https://github.com/o/r" }],
    });

    expect(warnings).toContain("Ignored a raw fragment at the reserved provenance path: codex/.ulis-provenance.json");
    const marker = JSON.parse(read(join(outputDir, "codex", ".ulis-provenance.json"))) as {
      remoteSources: readonly string[];
    };
    expect(marker.remoteSources).toEqual(["https://github.com/o/r"]);

    await expect(
      runInstall({
        sourceDir,
        outputDir,
        destBase: projectDir,
        userHome: join(root, "home"),
        platforms: ["codex"],
        rebuild: false,
        logger: silentLogger,
      }),
    ).rejects.toThrow(/https:\/\/github\.com\/o\/r/u);
  });
  it("refuses the whole install when one selected platform marker is corrupt", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    writeMinimalSource(sourceDir, "base");
    write(
      join(outputDir, "claude", ".ulis-provenance.json"),
      JSON.stringify({ version: 1, remoteSources: ["https://github.com/o/r"] }),
    );
    write(join(outputDir, "codex", ".ulis-provenance.json"), "{ corrupt");

    await expect(
      runInstall({
        sourceDir,
        outputDir,
        destBase: projectDir,
        userHome: join(root, "home"),
        platforms: ["claude", "codex"],
        rebuild: false,
        logger: silentLogger,
      }),
    ).rejects.toThrow(/provenance record for codex/u);
    expect(existsSync(join(projectDir, ".claude"))).toBe(false);
  });
  it("reads a valid marker through a symlinked platform directory", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const claudeTarget = join(root, "claude-output");
    writeMinimalSource(sourceDir, "base");
    write(
      join(claudeTarget, ".ulis-provenance.json"),
      JSON.stringify({ version: 1, remoteSources: ["https://github.com/o/r"] }),
    );
    mkdirSync(outputDir, { recursive: true });
    symlinkSync(claudeTarget, join(outputDir, "claude"), process.platform === "win32" ? "junction" : "dir");

    await expect(
      runInstall({
        sourceDir,
        outputDir,
        destBase: projectDir,
        userHome: join(root, "home"),
        platforms: ["claude"],
        rebuild: false,
        logger: silentLogger,
      }),
    ).rejects.toThrow(/https:\/\/github\.com\/o\/r/u);
    expect(existsSync(join(projectDir, ".claude"))).toBe(false);
  });
  it("writes byte-identical markers when preset order changes", () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const presetA = join(root, "preset-a");
    const presetB = join(root, "preset-b");
    writeMinimalSource(sourceDir, "base");
    writeMinimalSource(presetA, "a");
    writeMinimalSource(presetB, "b");
    const a = { name: "a", dir: presetA, remoteUrl: "https://github.com/a/r" };
    const b = { name: "b", dir: presetB, remoteUrl: "https://github.com/b/r" };
    const firstOutput = join(root, "first");
    const secondOutput = join(root, "second");

    runBuild({ sourceDir, outputDir: firstOutput, targets: ["codex"], logger: silentLogger, presets: [a, b] });
    runBuild({ sourceDir, outputDir: secondOutput, targets: ["codex"], logger: silentLogger, presets: [b, a] });

    expect(read(join(firstOutput, "codex", ".ulis-provenance.json"))).toBe(
      read(join(secondOutput, "codex", ".ulis-provenance.json")),
    );
  });
});
