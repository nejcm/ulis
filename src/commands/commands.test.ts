import { afterEach, describe, expect, it } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { __test } from "../install.js";
import { __test as installInterrupt } from "../utils/interrupt.js";
import { logger as log } from "../utils/logger.js";
import { buildCmd } from "./build.js";
import { initCmd } from "./init.js";
import { installCmd } from "./install.js";
import { presetInstallCmd } from "./preset.js";

const fixturesDir = resolve(join(import.meta.dirname, "../../tests/fixtures"));
const originalCwd = process.cwd();
const tmpRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-cmd-"));
  tmpRoots.push(root);
  return root;
}

function copyFixtureSource(projectRoot: string, dirname = ".ulis"): string {
  const sourceDir = join(projectRoot, dirname);
  cpSync(fixturesDir, sourceDir, { recursive: true });
  return sourceDir;
}

afterEach(() => {
  __test.resetRuntimeDependencies();
  process.chdir(originalCwd);
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Stub `git clone` so remote-source tests need no network. Returns the clone temp roots, which must
 * all be gone by the end of the run.
 */
function mockClone(build?: (dir: string) => void): string[] {
  const cloned: string[] = [];
  __test.setRuntimeDependencies({
    runCommand(_lookup, args) {
      // `git` is on PATH, `gh` is not - so a failed clone takes no retry path.
      return { status: args[0] === "gh" ? 1 : 0 } as never;
    },
    async runAsyncCommand(command, args, spawnOptions) {
      if (command !== "git") return { status: 0, stdout: "", stderr: "" };
      const dir = args[args.length - 1]!;
      cloned.push(resolve(dir, ".."));
      mkdirSync(dir, { recursive: true });
      if (build) build(dir);
      else cpSync(fixturesDir, dir, { recursive: true });
      // A real spawn dies when its signal aborts.
      if (spawnOptions?.signal?.aborted) return { status: 1, stdout: "", stderr: "aborted" };
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  return cloned;
}

/** Fire the SIGINT handler installCmd registered, without raising a real signal. */
function pressCtrlC(): void {
  (process.listeners("SIGINT").at(-1) as ((signal: string) => void) | undefined)?.("SIGINT");
}

/**
 * Record interrupt exits instead of stopping the process. `onExit` samples state at the moment the
 * real process would have died - the only way to prove cleanup happened *before* the exit.
 */
function captureExit(options: { onExit?: () => void; halts?: boolean } = {}): {
  exits: number[];
  restore: () => void;
} {
  const original = installInterrupt.exitOnInterrupt;
  const exits: number[] = [];
  installInterrupt.exitOnInterrupt = () => {
    exits.push(1);
    options.onExit?.();
    // The real exit ends the process; `halts` stands in for that so the run cannot continue.
    if (options.halts) throw new Error("interrupted");
  };
  return { exits, restore: () => void (installInterrupt.exitOnInterrupt = original) };
}

function captureLog(lines: string[]): () => void {
  const original = log.info;
  log.info = (message: string) => void lines.push(message);
  return () => {
    log.info = original;
  };
}

describe("commands", () => {
  it("initCmd scaffolds a project-local source tree", async () => {
    const projectRoot = createTempRoot();
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "command-test" }));
    process.chdir(projectRoot);

    await initCmd();

    expect(existsSync(join(projectRoot, ".ulis", "config.yaml"))).toBe(true);
    expect(existsSync(join(projectRoot, ".ulis", "extensions.yaml"))).toBe(true);
    expect(existsSync(join(projectRoot, ".ulis", "agents", ".gitkeep"))).toBe(true);
    expect(readFileSync(join(projectRoot, ".ulis", "config.yaml"), "utf8")).toContain("name: command-test");
    expect(readFileSync(join(projectRoot, ".ulis", "extensions.yaml"), "utf8")).toContain("extensions");
    expect(readFileSync(join(projectRoot, ".gitignore"), "utf8")).toContain("/.ulis/generated/");
  });

  it("initCmd points global schema refs at the installed package", async () => {
    const homeRoot = createTempRoot();

    await initCmd({ global: true, homeDir: homeRoot });

    const installedSchemas = pathToFileURL(resolve(join(import.meta.dirname, "../../schemas"))).href;
    expect(readFileSync(join(homeRoot, ".ulis", "config.yaml"), "utf8")).toContain(
      `$schema=${installedSchemas}/config.schema.json`,
    );
  });

  it("buildCmd writes selected generated output under the project source tree", async () => {
    const projectRoot = createTempRoot();
    copyFixtureSource(projectRoot);
    process.chdir(projectRoot);

    await buildCmd({ target: "claude" });

    expect(existsSync(join(projectRoot, ".ulis", "generated", "claude", "agents", "worker.md"))).toBe(true);
    expect(existsSync(join(projectRoot, ".ulis", "generated", "opencode"))).toBe(false);
  });

  it("buildCmd honors explicit --source over project-local source", async () => {
    const projectRoot = createTempRoot();
    copyFixtureSource(projectRoot, "custom-source");
    process.chdir(projectRoot);

    await buildCmd({ source: "custom-source", target: "cursor" });

    expect(existsSync(join(projectRoot, "custom-source", "generated", "cursor", "agents", "worker.mdc"))).toBe(true);
    expect(existsSync(join(projectRoot, ".ulis", "generated"))).toBe(false);
  });

  it("buildCmd with an empty target does not default to all platforms", async () => {
    const projectRoot = createTempRoot();
    copyFixtureSource(projectRoot);
    process.chdir(projectRoot);

    await buildCmd({ target: "" });

    expect(existsSync(join(projectRoot, ".ulis", "generated"))).toBe(false);
  });

  it("buildCmd rejects a remote source before doing any work", async () => {
    const projectRoot = createTempRoot();
    copyFixtureSource(projectRoot);
    process.chdir(projectRoot);

    await expect(buildCmd({ source: "https://github.com/o/r", target: "claude" })).rejects.toThrow(
      "build writes generated output into the source tree, and a remote source is discarded after the run. " +
        "Use `ulis install --source <url>` instead.",
    );

    // Rejected before any work: no clone, no generated output.
    expect(existsSync(join(projectRoot, ".ulis", "generated"))).toBe(false);
  });

  it("buildCmd rejects an unsupported protocol instead of pointing at install", async () => {
    // `ulis install` would refuse `git://` too, so sending the user there would waste a round trip.
    await expect(buildCmd({ source: "git://github.com/o/r", target: "claude" })).rejects.toThrow(/HTTPS or SSH/u);
  });

  it("installCmd installs generated config into the project platform directory", async () => {
    const projectRoot = createTempRoot();
    copyFixtureSource(projectRoot);
    process.chdir(projectRoot);

    await installCmd({ yes: true, target: "claude" });

    expect(existsSync(join(projectRoot, ".claude", "agents", "worker.md"))).toBe(true);
    expect(existsSync(join(projectRoot, ".mcp.json"))).toBe(true);
    expect(readFileSync(join(projectRoot, ".claude", "agents", "worker.md"), "utf8")).toContain("A minimal test agent");
  });

  it("installCmd installs Claude agents using explicit frontmatter names", async () => {
    const projectRoot = createTempRoot();
    copyFixtureSource(projectRoot);
    writeFileSync(
      join(projectRoot, ".ulis", "agents", "local-file.md"),
      [
        "---",
        "name: refactoring-specialist",
        "description: Refactor safely",
        "tools: Read, Write, Edit, Bash, Glob, Grep",
        "model: sonnet",
        "---",
        "You are a refactoring specialist.",
      ].join("\n"),
    );
    process.chdir(projectRoot);

    await installCmd({ yes: true, target: "claude" });

    expect(existsSync(join(projectRoot, ".claude", "agents", "refactoring-specialist.md"))).toBe(true);
    expect(existsSync(join(projectRoot, ".claude", "agents", "local-file.md"))).toBe(false);
  });

  it("installCmd with an empty target does not install platform configs", async () => {
    const projectRoot = createTempRoot();
    copyFixtureSource(projectRoot);
    process.chdir(projectRoot);

    await installCmd({ yes: true, target: "" });

    expect(existsSync(join(projectRoot, ".claude"))).toBe(false);
    expect(existsSync(join(projectRoot, ".codex"))).toBe(false);
    expect(existsSync(join(projectRoot, ".cursor"))).toBe(false);
    expect(existsSync(join(projectRoot, ".opencode"))).toBe(false);
    expect(existsSync(join(projectRoot, ".forge"))).toBe(false);
  });

  it("installCmd clones a remote source, installs it, then removes the temp directory", async () => {
    const projectRoot = createTempRoot();
    process.chdir(projectRoot);
    const cloned = mockClone();
    const before = process.listenerCount("SIGINT");

    await installCmd({ yes: true, target: "claude", source: "https://github.com/o/r" });

    expect(existsSync(join(projectRoot, ".claude", "agents", "worker.md"))).toBe(true);
    // The clone is a throwaway: nothing may survive the run.
    expect(cloned.map(existsSync)).toEqual([false]);
    // The interrupt handler must not outlive the command.
    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  it("installCmd treats a remote source with --global as a global install", async () => {
    const home = createTempRoot();
    process.chdir(createTempRoot());
    mockClone();

    await installCmd({ yes: true, target: "claude", source: "https://github.com/o/r", global: true, homeDir: home });

    // A remote source resolves to mode "remote", not "global" - only the flag says where it lands.
    expect(existsSync(join(home, ".claude.json"))).toBe(true);
    expect(existsSync(join(home, ".mcp.json"))).toBe(false);
  });

  it("installCmd uses global skill scope when the project destination is the user home", async () => {
    const home = createTempRoot();
    const sourceDir = copyFixtureSource(home);
    writeFileSync(join(sourceDir, "skills.yaml"), ['"*":', "  skills:", "    - name: test/skill", ""].join("\n"));
    process.chdir(home);
    const commands: Array<{ command: string; args: readonly string[] }> = [];
    __test.setRuntimeDependencies({
      async runAsyncCommand(command, args) {
        commands.push({ command, args });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    await installCmd({ yes: true, target: "claude", homeDir: home, extensions: false });

    expect(commands).toEqual([
      {
        command: "npx",
        args: ["skills@latest", "add", "test/skill", "-a", "claude-code", "-g", "--yes"],
      },
    ]);
  });

  it("installCmd leaves SIGINT alone for a local source", async () => {
    const projectRoot = createTempRoot();
    copyFixtureSource(projectRoot);
    process.chdir(projectRoot);
    const before = process.listenerCount("SIGINT");

    await installCmd({ yes: true, target: "claude" });

    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  it("installCmd aborts the clone and removes the temp directory on Ctrl-C", async () => {
    const projectRoot = createTempRoot();
    process.chdir(projectRoot);
    const before = process.listenerCount("SIGINT");
    let duringClone = 0;

    let cloned: string[] = [];
    // Sample at the instant the real process would have died: the temp dir must already be gone.
    const survivedAtExit: boolean[] = [];
    const exit = captureExit({ onExit: () => survivedAtExit.push(cloned.some(existsSync)) });
    cloned = mockClone((dir) => {
      duringClone = process.listenerCount("SIGINT");
      pressCtrlC();
      cpSync(fixturesDir, dir, { recursive: true });
    });

    try {
      await expect(installCmd({ yes: true, target: "claude", source: "https://github.com/o/r" })).rejects.toThrow(
        /Failed to clone/u,
      );
    } finally {
      exit.restore();
    }

    expect(duringClone).toBe(before + 1);
    expect(process.listenerCount("SIGINT")).toBe(before);
    expect(cloned.map(existsSync)).toEqual([false]);
    expect(existsSync(join(projectRoot, ".claude"))).toBe(false);
    // The interrupt aborts the clone and the exit is deferred until after the temp dir is gone.
    expect(survivedAtExit).toEqual([false]);
    expect(exit.exits).toHaveLength(1);
  });

  // "Press again to force quit". The first press defers its exit until the clone unwinds; a second
  // one must not be swallowed, or SIGINT, SIGTERM and SIGHUP would all be ignored until a wedged
  // clone times out, leaving SIGKILL as the only way out. Stopping at once can leave the temp
  // directory the clone still owns - that is the cost of the second press, not a regression.
  it("installCmd force-quits when Ctrl-C is pressed twice during the clone", async () => {
    const projectRoot = createTempRoot();
    process.chdir(projectRoot);
    const before = process.listenerCount("SIGINT");
    let cloned: string[] = [];
    // Sampled at the instant the real process would have died.
    const handlersAtExit: number[] = [];
    const exit = captureExit({ onExit: () => handlersAtExit.push(process.listenerCount("SIGINT")) });

    cloned = mockClone((dir) => {
      pressCtrlC(); // aborts the clone
      pressCtrlC(); // arrives before the clone has unwound: force quit
      cpSync(fixturesDir, dir, { recursive: true });
    });

    try {
      await expect(installCmd({ yes: true, target: "claude", source: "https://github.com/o/r" })).rejects.toThrow(
        /Failed to clone/u,
      );
    } finally {
      exit.restore();
    }

    // Exactly one exit: the second press takes it, and `release()` must not then repeat it.
    expect(exit.exits).toHaveLength(1);
    // The handlers are deregistered before the exit, so a third signal reaches the default handler.
    expect(handlersAtExit).toEqual([before]);
    expect(process.listenerCount("SIGINT")).toBe(before);
    // Nothing is installed, and the clone's own unwinding still removes its temp directory here.
    expect(existsSync(join(projectRoot, ".claude"))).toBe(false);
    expect(cloned.map(existsSync)).toEqual([false]);
  });

  it("installCmd cleans up and stops the run when Ctrl-C lands after the clone", async () => {
    const projectRoot = createTempRoot();
    process.chdir(projectRoot);
    const cloned = mockClone();
    const before = process.listenerCount("SIGINT");
    const exit = captureExit({ halts: true });
    const restoreLog = captureLog([]);

    // `Source: ...` is logged well after the clone, so it is a reliable post-clone hook.
    log.info = (message: string) => {
      if (message.startsWith("Source: ")) pressCtrlC();
    };

    try {
      await installCmd({ yes: true, target: "claude", source: "https://github.com/o/r" }).catch(() => undefined);
    } finally {
      restoreLog();
      exit.restore();
    }

    expect(cloned.map(existsSync)).toEqual([false]);
    expect(exit.exits).toHaveLength(1);
    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  it("installCmd removes the cloned temp directory when the install fails", async () => {
    const projectRoot = createTempRoot();
    process.chdir(projectRoot);
    // Clone succeeds but the tree is not a ULIS source, so the failure lands after the clone -
    // the case only installCmd's own `finally` can clean up.
    const cloned = mockClone((dir) => writeFileSync(join(dir, "config.yaml"), "version: [unclosed\n"));

    await expect(installCmd({ yes: true, target: "claude", source: "https://github.com/o/r" })).rejects.toThrow();
    expect(cloned.map(existsSync)).toEqual([false]);
  });

  it("installCmd logs the remote URL rather than the temp path, without credentials", async () => {
    const projectRoot = createTempRoot();
    process.chdir(projectRoot);
    mockClone();
    const lines: string[] = [];
    const restore = captureLog(lines);

    try {
      await installCmd({ yes: true, target: "claude", source: "https://user:s3cret@github.com/o/r" });
    } finally {
      restore();
    }

    expect(lines).toContain("Source: https://github.com/o/r");
    expect(lines.join("\n")).not.toContain("s3cret");
    // The other log lines legitimately name temp paths (destBase, generated output), so only the
    // Source line is asserted here.
  });

  it("installCmd with --yes fails fast for missing presets without prompting", async () => {
    const projectRoot = createTempRoot();
    copyFixtureSource(projectRoot);
    process.chdir(projectRoot);

    const missingPreset = `missing-${Date.now()}`;
    await expect(installCmd({ yes: true, target: "claude", preset: missingPreset })).rejects.toThrow(
      `Preset "${missingPreset}" not found`,
    );
  });

  it("presetInstallCmd installs a preset without requiring a project source", async () => {
    const projectRoot = createTempRoot();
    const presetsRoot = join(projectRoot, "presets");
    const bundledPresetsRoot = join(projectRoot, "bundled-presets");
    const presetDir = join(presetsRoot, "team");
    mkdirSync(join(presetDir, "agents"), { recursive: true });
    writeFileSync(join(presetDir, "config.yaml"), "version: 1\nname: team\n");
    writeFileSync(
      join(presetDir, "agents", "worker.md"),
      [
        "---",
        "description: Preset worker",
        "model: claude-haiku-4-5-20251001",
        "tools:",
        "  read: true",
        "---",
        "Preset worker.",
      ].join("\n"),
    );
    mkdirSync(bundledPresetsRoot, { recursive: true });
    process.chdir(projectRoot);

    await presetInstallCmd("team", { yes: true, target: "claude", presetsRoot, bundledPresetsRoot });

    expect(existsSync(join(projectRoot, ".claude", "agents", "worker.md"))).toBe(true);
    expect(existsSync(join(projectRoot, ".ulis"))).toBe(false);
    expect(existsSync(join(presetDir, "generated"))).toBe(false);
  });

  it("presetInstallCmd uses global skill scope when the project destination is the user home", async () => {
    const home = createTempRoot();
    const presetsRoot = join(home, "presets");
    const bundledPresetsRoot = join(home, "bundled-presets");
    const presetDir = join(presetsRoot, "team");
    mkdirSync(presetDir, { recursive: true });
    mkdirSync(bundledPresetsRoot, { recursive: true });
    writeFileSync(join(presetDir, "config.yaml"), "version: 1\nname: team\n");
    writeFileSync(join(presetDir, "skills.yaml"), ['"*":', "  skills:", "    - name: test/skill", ""].join("\n"));
    process.chdir(home);
    const commands: Array<{ command: string; args: readonly string[] }> = [];
    __test.setRuntimeDependencies({
      async runAsyncCommand(command, args) {
        commands.push({ command, args });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    await presetInstallCmd("team", {
      yes: true,
      target: "claude",
      userHome: home,
      presetsRoot,
      bundledPresetsRoot,
      extensions: false,
    });

    expect(commands).toEqual([
      {
        command: "npx",
        args: ["skills@latest", "add", "test/skill", "-a", "claude-code", "-g", "--yes"],
      },
    ]);
  });

  it("presetInstallCmd accepts comma-separated and repeated names in order", async () => {
    const projectRoot = createTempRoot();
    const presetsRoot = join(projectRoot, "presets");
    const bundledPresetsRoot = join(projectRoot, "bundled-presets");
    for (const name of ["a", "b", "c"]) {
      const presetDir = join(presetsRoot, name);
      mkdirSync(join(presetDir, "agents"), { recursive: true });
      writeFileSync(join(presetDir, "config.yaml"), `version: 1\nname: ${name}\n`);
      writeFileSync(
        join(presetDir, "agents", "worker.md"),
        [
          "---",
          `description: Preset ${name}`,
          "model: claude-haiku-4-5-20251001",
          "tools:",
          "  read: true",
          "---",
          `Preset ${name}.`,
        ].join("\n"),
      );
    }
    mkdirSync(bundledPresetsRoot, { recursive: true });
    process.chdir(projectRoot);

    await presetInstallCmd(["a,b", "c"], { yes: true, target: "claude", presetsRoot, bundledPresetsRoot });

    const installedAgent = readFileSync(join(projectRoot, ".claude", "agents", "worker.md"), "utf8");
    expect(installedAgent).toContain("Preset c");
  });
});

/**
 * A declined overwrite prompt must be exit code 1, as `docs/CLI.md` documents, and must install
 * nothing. Driven through a child process because that is the only way to observe the real exit
 * code, and because the prompt needs a real stdin at EOF — which is also the case that used to hang
 * forever instead of declining. `confirm` is imported directly by `installCmd`, so there is no
 * in-process seam to stub without adding one to production code for the test's benefit.
 */
describe("installCmd with a declined overwrite prompt", () => {
  it("exits 1 and installs nothing when stdin is at EOF", async () => {
    const projectRoot = createTempRoot();
    copyFixtureSource(projectRoot);
    // A non-empty platform directory is what triggers the collision prompt.
    mkdirSync(join(projectRoot, ".claude"), { recursive: true });
    writeFileSync(join(projectRoot, ".claude", "settings.local.json"), '{"pre": "existing"}');

    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dirname, "../cli.ts"),
        "install",
        "--target",
        "claude",
        "--skip-external-skills",
        "--skip-extensions",
      ],
      { cwd: projectRoot, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
    );

    const stderr = await new Response(child.stderr).text();
    expect(await child.exited).toBe(1);
    expect(stderr).toContain("Aborted by user.");
    // Nothing from the source reached the destination, and what was already there is untouched.
    expect(existsSync(join(projectRoot, ".claude", "agents"))).toBe(false);
    expect(existsSync(join(projectRoot, ".claude", ".ulis-manifest.json"))).toBe(false);
    expect(readFileSync(join(projectRoot, ".claude", "settings.local.json"), "utf8")).toBe('{"pre": "existing"}');
  }, 60_000);
});
