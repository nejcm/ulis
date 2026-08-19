import { afterEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { __test as installTest } from "../install.js";
import { createInitialState, reviewFingerprint } from "./state.js";

const fixturesDir = resolve(import.meta.dirname, "../../tests/fixtures");

/** Stub `git clone` so the TUI remote paths need no network or `git`. */
function mockClone(): string[] {
  const cloned: string[] = [];
  installTest.setRuntimeDependencies({
    runCommand(_lookup: string, args: readonly string[]) {
      return { status: args[0] === "gh" ? 1 : 0 } as never;
    },
    async runAsyncCommand(command: string, args: readonly string[]) {
      if (command !== "git") return { status: 0, stdout: "", stderr: "" };
      const dir = args[args.length - 1]!;
      cloned.push(resolve(dir, ".."));
      mkdirSync(dir, { recursive: true });
      cpSync(fixturesDir, dir, { recursive: true });
      return { status: 0, stdout: "", stderr: "" };
    },
  } as never);
  return cloned;
}

// Typed against the real module rather than by hand: a signature this file gets wrong is a test
// that proves nothing. The query string forces a fresh instance so the runtime stubs below are
// scoped to this file.
const actionsModule = (await import(`./actions.ts?real=${Date.now()}`)) as typeof import("./actions.js");
const runTuiAction = actionsModule.runTuiAction;
const __test = actionsModule.__test;

const spawnCalls: Array<{
  command: string;
  args: readonly string[];
  stdio: readonly string[];
  env?: NodeJS.ProcessEnv;
}> = [];
const presetInstallCalls: Array<{
  destBase: string;
  globalInstall?: boolean;
  platforms?: readonly string[];
  backup?: boolean;
  presets: readonly { name: string; dir: string }[];
  installExtensions?: boolean;
  signal?: AbortSignal;
}> = [];
const installCalls: Array<{
  sourceDir: string;
  destBase: string;
  platforms?: readonly string[];
}> = [];
const spawnedChildren: Array<{
  stdout: EventEmitter;
  stderr: EventEmitter;
  killed: () => boolean;
  killSignals: () => string[];
  emitClose: (code: number | null) => void;
  emitError: (error: Error) => void;
}> = [];

function installRuntimeFakes(): void {
  __test.setRuntimeDependencies({
    spawn: ((
      command: string,
      args: readonly string[],
      options: { stdio: readonly string[]; env?: NodeJS.ProcessEnv },
    ) => {
      spawnCalls.push({ command, args, stdio: options.stdio, env: options.env });
      const emitter = new EventEmitter();
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      let killed = false;
      const killSignals: string[] = [];
      const child = Object.assign(emitter, {
        stdout,
        stderr,
        kill: (signal?: string) => {
          killed = true;
          killSignals.push(signal ?? "default");
          return true;
        },
      });
      spawnedChildren.push({
        stdout,
        stderr,
        killed: () => killed,
        killSignals: () => killSignals,
        emitClose: (code: number | null) => emitter.emit("close", code),
        emitError: (error: Error) => emitter.emit("error", error),
      });
      return child as never;
    }) as unknown as typeof import("node:child_process").spawn,
    createInterface: (({ input }: { input: EventEmitter }) => {
      const listeners = new Map<string, (...args: unknown[]) => void>();
      return {
        on: (event: "line", callback: (line: string) => void) => {
          const wrapped = (...args: unknown[]) => callback(String(args[0] ?? ""));
          listeners.set(event, wrapped);
          input.on(event, wrapped);
        },
        close: () => {
          for (const [event, callback] of listeners) {
            input.off(event, callback);
          }
        },
      };
    }) as unknown as typeof import("node:readline").createInterface,
    runPresetInstall: (async (options: (typeof presetInstallCalls)[number]) => {
      presetInstallCalls.push(options);
      return options.platforms ?? [];
    }) as never,
    // Stubbed here, not per test: a real `runInstall` reached from a remote fixture resolves the
    // URL as a relative path and writes a `https:/...` tree into the repo. Any test that gets
    // further than it meant to must land in this recorder instead of on the disk.
    runInstall: (async (options: (typeof installCalls)[number]) => {
      installCalls.push(options);
      return options.platforms ?? [];
    }) as never,
  });
}

function createLogger() {
  const dim: string[] = [];
  const info: string[] = [];
  const success: string[] = [];
  const warn: string[] = [];
  const error: string[] = [];
  return {
    header: (_message: string) => undefined,
    info: (message: string) => info.push(message),
    success: (message: string) => success.push(message),
    dim: (message: string) => dim.push(message),
    warn: (message: string) => warn.push(message),
    error: (message: string) => error.push(message),
    infoLogs: info,
    successLogs: success,
    dimLogs: dim,
    warnLogs: warn,
    errorLogs: error,
  };
}

describe("tui actions child process flow", () => {
  afterEach(() => {
    __test.resetRuntimeDependencies();
  });

  it("build action spawns current CLI entry with source, targets, and presets", async () => {
    installRuntimeFakes();
    spawnCalls.length = 0;
    spawnedChildren.length = 0;
    const state = createInitialState([
      { name: "team", displayName: "Team", description: "", source: "user", dir: "/presets/team" },
    ]);
    state.selectedPresetNames = ["team"];
    state.platforms = ["claude", "cursor"];
    const logger = createLogger();

    const run = runTuiAction(state, "build", logger);
    const child = spawnedChildren[0];
    expect(child).toBeDefined();
    child!.emitClose(0);
    await run;

    expect(spawnCalls).toHaveLength(1);
    const call = spawnCalls[0]!;
    expect(call.command).toBe(process.execPath);
    expect(call.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(call.env?.ULIS_NON_INTERACTIVE).toBe("1");
    expect(call.args).toContain("build");
    expect(call.args).toContain("--source");
    expect(call.args).toContain("--target");
    expect(call.args).toContain("claude,cursor");
    expect(call.args).toContain("--preset");
    expect(call.args).toContain("team");
  });

  it("plans the child's source from the injected cwd", async () => {
    installRuntimeFakes();
    spawnCalls.length = 0;
    spawnedChildren.length = 0;
    const state = createInitialState();

    // The review screen planned with this cwd; the child has to be told the same one.
    const run = runTuiAction(state, "build", createLogger(), { cwd: "/tmp/ulis-injected-cwd" });
    spawnedChildren[0]!.emitClose(0);
    await run;

    const source = spawnCalls[0]!.args[spawnCalls[0]!.args.indexOf("--source") + 1];
    expect(source).toBe("/tmp/ulis-injected-cwd/.ulis");
  });

  it("uses the propagated CLI entry when running in the Bun TUI child", async () => {
    installRuntimeFakes();
    spawnCalls.length = 0;
    spawnedChildren.length = 0;
    const previous = process.env.ULIS_CLI_ENTRY;
    process.env.ULIS_CLI_ENTRY = "/app/dist/cli.js";

    try {
      const run = runTuiAction(createInitialState(), "build", createLogger());
      spawnedChildren[0]!.emitClose(0);
      await run;
      expect(spawnCalls[0]!.args).toContain("/app/dist/cli.js");
      expect(spawnCalls[0]!.args).not.toContain(process.argv[1]);
    } finally {
      if (previous == null) delete process.env.ULIS_CLI_ENTRY;
      else process.env.ULIS_CLI_ENTRY = previous;
    }
  });

  it("install action includes non-interactive and install flags", async () => {
    installRuntimeFakes();
    spawnCalls.length = 0;
    spawnedChildren.length = 0;
    const state = createInitialState();
    state.platforms = ["codex"];
    state.destinationMode = "global";
    state.backup = true;
    state.prune = false;
    state.rebuild = false;
    const logger = createLogger();

    const run = runTuiAction(state, "install", logger);
    const child = spawnedChildren[0];
    expect(child).toBeDefined();
    child!.emitClose(0);
    await run;

    const args = spawnCalls[0]!.args;
    expect(args).toContain("install");
    expect(args).toContain("--target");
    expect(args).toContain("codex");
    expect(args).toContain("--yes");
    expect(args).toContain("--global");
    expect(args).toContain("--skip-rebuild");
    expect(args).toContain("--backup");
    expect(args).toContain("--no-prune");
  });

  it("preset install action uses resolved preset directories", async () => {
    installRuntimeFakes();
    spawnCalls.length = 0;
    presetInstallCalls.length = 0;
    spawnedChildren.length = 0;
    const state = createInitialState([
      { name: "b", displayName: "B", description: "", source: "project", dir: "/project/presets/b" },
      { name: "a", displayName: "A", description: "", source: "project", dir: "/project/presets/a" },
    ]);
    state.flow = "presetsOnly";
    state.selectedPresetNames = ["project:a", "project:b"];
    state.platforms = ["codex"];
    state.destinationMode = "global";
    state.backup = true;
    state.prune = false;
    state.presetInstallExtensions = false;
    const logger = createLogger();

    await runTuiAction(state, "presetInstall", logger);

    expect(spawnCalls).toHaveLength(0);
    expect(presetInstallCalls).toHaveLength(1);
    expect(presetInstallCalls[0]!).toMatchObject({
      globalInstall: true,
      platforms: ["codex"],
      backup: true,
      prune: false,
      installExtensions: false,
      presets: [
        { name: "a", dir: "/project/presets/a" },
        { name: "b", dir: "/project/presets/b" },
      ],
    });
  });

  it("preset install action forwards cancellation to the installer", async () => {
    installRuntimeFakes();
    presetInstallCalls.length = 0;
    const state = createInitialState([
      { name: "team", displayName: "Team", description: "", source: "project", dir: "/project/presets/team" },
    ]);
    state.flow = "presetsOnly";
    state.selectedPresetNames = ["project:team"];
    const logger = createLogger();
    const controller = new AbortController();
    __test.setRuntimeDependencies({
      runPresetInstall: ((options: (typeof presetInstallCalls)[number]) => {
        presetInstallCalls.push(options);
        return new Promise<readonly string[]>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(new Error("Preset install stopped by user.")), {
            once: true,
          });
        });
      }) as never,
    });

    const run = runTuiAction(state, "presetInstall", logger, { signal: controller.signal });
    controller.abort();

    await expect(run).rejects.toThrow("Preset install stopped by user.");
    expect(presetInstallCalls[0]?.signal).toBe(controller.signal);
  });

  it("forwards an empty target when no platforms are selected", async () => {
    installRuntimeFakes();
    spawnCalls.length = 0;
    spawnedChildren.length = 0;
    const state = createInitialState();
    state.platforms = [];
    const logger = createLogger();

    const run = runTuiAction(state, "build", logger);
    const child = spawnedChildren[0];
    expect(child).toBeDefined();
    child!.emitClose(0);
    await run;

    const args = spawnCalls[0]!.args;
    const targetIndex = args.indexOf("--target");
    expect(targetIndex).toBeGreaterThan(-1);
    expect(args[targetIndex + 1]).toBe("");
  });

  it("forwards sanitized stdout/stderr lines to logger", async () => {
    installRuntimeFakes();
    spawnCalls.length = 0;
    spawnedChildren.length = 0;
    const state = createInitialState();
    const logger = createLogger();

    const run = runTuiAction(state, "build", logger);
    const child = spawnedChildren[0]!;
    child.stdout.emit("line", "\u001b[31mstdout-line\u001b[0m");
    child.stderr.emit("line", "\u001b[33mstderr-line\u001b[0m");
    child.emitClose(0);
    await run;

    expect(logger.infoLogs).toContain("stdout-line");
    expect(logger.warnLogs).toContain("stderr-line");
  });

  it("preserves child log levels without duplicating their tags", async () => {
    installRuntimeFakes();
    spawnCalls.length = 0;
    spawnedChildren.length = 0;
    const state = createInitialState();
    const logger = createLogger();

    const run = runTuiAction(state, "build", logger);
    const child = spawnedChildren[0]!;
    child.stdout.emit("line", "\u001b[36m[info]\u001b[0m source ready");
    child.stdout.emit("line", "\u001b[32m[done]\u001b[0m build complete");
    child.stdout.emit("line", "  copied: .codex/config.toml");
    child.stderr.emit("line", "\u001b[33m[warn]\u001b[0m deprecated option");
    child.stderr.emit("line", "\u001b[31m[error]\u001b[0m invalid config");
    child.stderr.emit("line", "\u001b[31m[error]\u001b[0m   path: .ulis/ulis.yaml");
    child.emitClose(0);
    await run;

    expect(logger.infoLogs).toContain("source ready");
    expect(logger.infoLogs).toContain("copied: .codex/config.toml");
    expect(logger.successLogs).toEqual(["build complete"]);
    expect(logger.warnLogs).toContain("deprecated option");
    expect(logger.errorLogs).toEqual(["invalid config", "path: .ulis/ulis.yaml"]);
    expect(logger.infoLogs).not.toContain("[info] source ready");
  });

  it("rejects when child process exits non-zero", async () => {
    installRuntimeFakes();
    spawnCalls.length = 0;
    spawnedChildren.length = 0;
    const state = createInitialState();
    const logger = createLogger();

    const run = runTuiAction(state, "build", logger);
    spawnedChildren[0]!.emitClose(2);

    await expect(run).rejects.toThrow("build exited with code 2");
  });

  it("kills the child process when the action signal is aborted", async () => {
    installRuntimeFakes();
    spawnCalls.length = 0;
    spawnedChildren.length = 0;
    const state = createInitialState();
    const logger = createLogger();
    const controller = new AbortController();

    const run = runTuiAction(state, "install", logger, { signal: controller.signal });
    const child = spawnedChildren[0]!;
    controller.abort();
    // A real child exits after SIGINT, once its own cleanup has run.
    child.emitClose(130);

    await expect(run).rejects.toThrow("install stopped by user");
    expect(child.killed()).toBe(true);
    // SIGINT rather than a plain kill, so the child can remove anything it cloned.
    expect(child.killSignals()).toEqual(["SIGINT"]);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    installRuntimeFakes();
    spawnCalls.length = 0;
    spawnedChildren.length = 0;
    const controller = new AbortController();
    controller.abort();

    // No child at all: spawning one here would arm the cancel grace timer with nothing left to
    // clear it, stalling the run for CHILD_CANCEL_GRACE_MS on pipes nobody reads.
    const started = Date.now();
    await expect(
      runTuiAction(createInitialState(), "build", createLogger(), { signal: controller.signal }),
    ).rejects.toThrow("build stopped by user");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(spawnCalls).toHaveLength(0);
  });

  it("never hands a remote source to the child process", async () => {
    installRuntimeFakes();
    spawnCalls.length = 0;
    spawnedChildren.length = 0;
    const state = createInitialState();
    state.sourceMode = "custom";
    state.customSource = "https://user:s3cret@github.com/o/r";

    // `ulis build` rejects a remote source anyway; spawning would only leak the credentials.
    await expect(runTuiAction(state, "build", createLogger())).rejects.toThrow(/remote source/u);
    expect(spawnCalls).toHaveLength(0);
  });

  it("throws when CLI entry script cannot be resolved", async () => {
    installRuntimeFakes();
    const state = createInitialState();
    const logger = createLogger();
    const originalArgv = [...process.argv];
    (process.argv as string[])[1] = "";

    try {
      await expect(runTuiAction(state, "build", logger)).rejects.toThrow("Unable to resolve current CLI entry script.");
    } finally {
      process.argv.splice(0, process.argv.length, ...originalArgv);
    }
  });
});

describe("tui remote sources", () => {
  const url = "https://github.com/o/r";

  afterEach(() => {
    __test.resetRuntimeDependencies();
    installTest.resetRuntimeDependencies();
  });

  it("validate clones a remote source, reads it, and removes the clone", async () => {
    const cloned = mockClone();
    const state = createInitialState();
    state.sourceMode = "custom";
    state.customSource = url;
    const logger = createLogger();

    await runTuiAction(state, "validate", logger);

    expect(logger.successLogs.join("\n")).toContain("Validated");
    // The URL is logged, never the temp path.
    expect(logger.infoLogs).toContain(`Source: ${url}`);
    expect(cloned).toHaveLength(1);
    expect(cloned.map(existsSync)).toEqual([false]);
  });

  it("validate removes the clone when analysis throws", async () => {
    const cloned = mockClone();
    const state = createInitialState();
    state.sourceMode = "custom";
    state.customSource = `${url}/tree/main/does-not-exist`;
    const logger = createLogger();

    await expect(runTuiAction(state, "validate", logger)).rejects.toThrow();
    expect(cloned.map(existsSync)).toEqual([false]);
  });

  it("never logs credentials from a pasted URL", async () => {
    mockClone();
    const state = createInitialState();
    state.sourceMode = "custom";
    state.customSource = "https://user:s3cret@github.com/o/r";
    const logger = createLogger();

    await runTuiAction(state, "validate", logger);

    const everything = [...logger.infoLogs, ...logger.successLogs, ...logger.warnLogs, ...logger.errorLogs].join("\n");
    expect(everything).not.toContain("s3cret");
    expect(everything).toContain("https://github.com/o/r");
  });

  it("preset install uses the review screen's clone and declares the remote source", async () => {
    const calls: Record<string, unknown>[] = [];
    __test.setRuntimeDependencies({
      runPresetInstall: ((opts: Record<string, unknown>) => {
        calls.push(opts);
        return Promise.resolve([]);
      }) as never,
    });
    const state = createInitialState();
    state.flow = "presetsOnly";
    state.presetSourceMode = "custom";
    state.customPresetSource = url;
    const prepared = {
      action: "presetInstall" as const,
      fingerprint: reviewFingerprint(state, "presetInstall"),
      presets: [{ name: "r", dir: "/tmp/clone/repo" }],
      commands: ["npx skills@latest add demo -a claude --project --yes"],
      cleanup: () => {},
    };

    await runTuiAction(state, "presetInstall", createLogger(), { prepared });

    // The clone reviewed on screen is the one installed.
    expect(calls[0]!.presets).toEqual(prepared.presets);
    // Declared remote so the gate sees it, and the reviewed list rides along so the installer can
    // check it against what it actually plans rather than being told to skip the prompt.
    expect(calls[0]!.remoteSources).toEqual([url]);
    expect(calls[0]!.approvedCommands).toEqual(prepared.commands);
    expect(calls[0]!.nonInteractive).toBeUndefined();
  });

  it("installs a reviewed remote source to the reviewed destination, not next to the clone", async () => {
    const calls: Record<string, unknown>[] = [];
    __test.setRuntimeDependencies({
      runInstall: ((opts: Record<string, unknown>) => {
        calls.push(opts);
        return Promise.resolve([]);
      }) as never,
    });
    const state = createInitialState();
    state.flow = "custom";
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];
    const prepared = {
      action: "install" as const,
      fingerprint: reviewFingerprint(state, "install"),
      sourceDir: "/tmp/ulis-remote-xyz/repo",
      presets: [],
      commands: ["npx skills@latest add demo -a claude --project --yes"],
      cleanup: () => {},
    };

    await runTuiAction(state, "install", createLogger(), { prepared });

    // Reads the clone...
    expect(calls[0]!.sourceDir).toBe("/tmp/ulis-remote-xyz/repo");
    // ...but writes to the reviewed project directory, NOT the clone's parent.
    expect(calls[0]!.destBase).toBe(process.cwd());
    expect(calls[0]!.destBase).not.toContain("ulis-remote-xyz");
    // The URL is logged, never the temp path, and consent came from the review screen.
    expect(calls[0]!.sourceLabel).toBe(url);
    expect(calls[0]!.remoteSources).toEqual([url]);
    // Declared remote from the resolver's own `mode` (`planned.remote`), not hardcoded `true` - see
    // the next test for why that distinction matters.
    expect(calls[0]!.sourceIsRemote).toBe(true);
    expect(calls[0]!.approvedCommands).toEqual(prepared.commands);
    expect(calls[0]!.nonInteractive).toBeUndefined();
  });

  // Defensive branch, not reachable through the UI today (see the comment in `actions.ts` above
  // this branch: `remoteRef` cannot be set for action "install"). Locks in correctness anyway:
  // `sourceIsRemote` must follow the base source's own identity (`planned.remote`, false here)
  // rather than the enclosing branch's remote condition - passing `true` here would drop that local
  // source's own `.env` for no reason, and the trust-gate label must name the preset ref, not the
  // local base path.
  it("keeps the local base source's identity when only a presets-only ref is remote", async () => {
    const calls: Record<string, unknown>[] = [];
    __test.setRuntimeDependencies({
      runInstall: ((opts: Record<string, unknown>) => {
        calls.push(opts);
        return Promise.resolve([]);
      }) as never,
    });
    const state = createInitialState();
    // Base source stays local (default "project" mode) - only the preset ref is remote.
    state.flow = "presetsOnly";
    state.presetSourceMode = "custom";
    state.customPresetSource = url;
    state.platforms = ["claude"];
    const prepared = {
      action: "install" as const,
      fingerprint: reviewFingerprint(state, "install"),
      presets: [{ name: "r", dir: "/tmp/clone/repo" }],
      commands: ["npx skills@latest add demo -a claude --project --yes"],
      cleanup: () => {},
    };

    await runTuiAction(state, "install", createLogger(), { prepared });

    expect(calls[0]!.sourceIsRemote).toBe(false);
    // The trust gate must attribute this run to the remote preset ref, not the local base source -
    // `planned.sourceDir` is a local path here, and printing it as "the remote source" would be
    // simply wrong, even though the gate itself still fires either way.
    expect(calls[0]!.sourceLabel).toBe(url);
    expect(calls[0]!.remoteSources).toEqual([url]);
  });

  it("refuses a remote source install that skipped the review screen", async () => {
    installRuntimeFakes();
    spawnCalls.length = 0;
    const state = createInitialState();
    state.sourceMode = "custom";
    state.customSource = url;

    // The child runs with --yes, so this is the last gate: it must fail closed.
    await expect(runTuiAction(state, "install", createLogger())).rejects.toThrow(/review screen/u);
    expect(spawnCalls).toHaveLength(0);
  });

  it("refuses an install whose settings changed after the review", async () => {
    installRuntimeFakes();
    spawnCalls.length = 0;
    const state = createInitialState();
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];
    const prepared = {
      action: "install" as const,
      fingerprint: reviewFingerprint(state, "install"),
      // Always the clone, never the URL: without it `runInstall` would resolve the URL as a path.
      sourceDir: "/tmp/ulis-remote-xyz/repo",
      presets: [],
      commands: [],
      cleanup: () => {},
    };

    // Reviewed for claude, started for claude+cursor: the displayed commands no longer match.
    state.platforms = ["claude", "cursor"];

    await expect(runTuiAction(state, "install", createLogger(), { prepared })).rejects.toThrow(/Settings changed/u);
    expect(spawnCalls).toHaveLength(0);
  });

  it("refuses a preset install whose extension toggle changed after the review", async () => {
    const calls: Record<string, unknown>[] = [];
    __test.setRuntimeDependencies({
      runPresetInstall: ((opts: Record<string, unknown>) => {
        calls.push(opts);
        return Promise.resolve([]);
      }) as never,
    });
    const state = createInitialState();
    state.flow = "presetsOnly";
    state.presetSourceMode = "custom";
    state.customPresetSource = url;
    state.presetInstallExtensions = false;
    const prepared = {
      action: "presetInstall" as const,
      fingerprint: reviewFingerprint(state, "presetInstall"),
      presets: [{ name: "r", dir: "/tmp/clone/repo" }],
      commands: [],
      cleanup: () => {},
    };

    // Extension commands were omitted from the review; turning them back on must invalidate it.
    state.presetInstallExtensions = true;

    await expect(runTuiAction(state, "presetInstall", createLogger(), { prepared })).rejects.toThrow(
      /Settings changed/u,
    );
    expect(calls).toHaveLength(0);
  });

  it("refuses a review generated for a different action", async () => {
    installRuntimeFakes();
    spawnCalls.length = 0;
    installCalls.length = 0;
    const state = createInitialState();
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    // A preset-install review never consents to a base install, whatever its fingerprint says.
    const prepared = {
      action: "presetInstall" as const,
      fingerprint: reviewFingerprint(state, "install"),
      sourceDir: "/tmp/ulis-remote-xyz/repo",
      presets: [],
      commands: [],
      cleanup: () => {},
    };

    await expect(runTuiAction(state, "install", createLogger(), { prepared })).rejects.toThrow(
      /only start the action it was generated for/u,
    );
    expect(spawnCalls).toHaveLength(0);
    expect(installCalls).toHaveLength(0);
  });

  it("refuses a remote preset install that skipped the review screen", async () => {
    const calls: Record<string, unknown>[] = [];
    __test.setRuntimeDependencies({
      runPresetInstall: ((opts: Record<string, unknown>) => {
        calls.push(opts);
        return Promise.resolve([]);
      }) as never,
    });
    const state = createInitialState();
    state.flow = "presetsOnly";
    state.presetSourceMode = "custom";
    state.customPresetSource = url;

    // Fail closed: nothing has shown the user what this would run.
    await expect(runTuiAction(state, "presetInstall", createLogger())).rejects.toThrow(/review screen/u);
    expect(calls).toHaveLength(0);
  });
});
