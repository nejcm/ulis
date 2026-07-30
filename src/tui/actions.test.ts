import { afterEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";

import { createInitialState } from "./state.js";

const actionsModule = (await import(`./actions.ts?real=${Date.now()}`)) as {
  runTuiAction: (
    state: ReturnType<typeof createInitialState>,
    action: "validate" | "presetValidate" | "build" | "install" | "presetInstall",
    logger: ReturnType<typeof createLogger>,
    options?: { signal?: AbortSignal },
  ) => Promise<void>;
  __test: {
    setRuntimeDependencies: (overrides: Record<string, unknown>) => void;
    resetRuntimeDependencies: () => void;
  };
};
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
const spawnedChildren: Array<{
  stdout: EventEmitter;
  stderr: EventEmitter;
  killed: () => boolean;
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
      const child = Object.assign(emitter, {
        stdout,
        stderr,
        kill: () => {
          killed = true;
          return true;
        },
      });
      spawnedChildren.push({
        stdout,
        stderr,
        killed: () => killed,
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

    await expect(run).rejects.toThrow("install stopped by user");
    expect(child.killed()).toBe(true);
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
