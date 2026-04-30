import { afterEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";

import { createInitialState } from "./state.js";

const actionsModule = (await import(`./actions.ts?real=${Date.now()}`)) as {
  runTuiAction: (
    state: ReturnType<typeof createInitialState>,
    action: "validate" | "build" | "install",
    logger: ReturnType<typeof createLogger>,
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
const spawnedChildren: Array<{
  stdout: EventEmitter;
  stderr: EventEmitter;
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
      const child = Object.assign(emitter, { stdout, stderr });
      spawnedChildren.push({
        stdout,
        stderr,
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
  });
}

function createLogger() {
  const dim: string[] = [];
  const warn: string[] = [];
  return {
    header: (_message: string) => undefined,
    info: (_message: string) => undefined,
    success: (_message: string) => undefined,
    dim: (message: string) => dim.push(message),
    warn: (message: string) => warn.push(message),
    error: (_message: string) => undefined,
    dimLogs: dim,
    warnLogs: warn,
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
    state.rebuild = false;
    const logger = createLogger();

    const run = runTuiAction(state, "install", logger);
    const child = spawnedChildren[0];
    expect(child).toBeDefined();
    child!.emitClose(0);
    await run;

    const args = spawnCalls[0]!.args;
    expect(args).toContain("install");
    expect(args).toContain("--yes");
    expect(args).toContain("--global");
    expect(args).toContain("--no-rebuild");
    expect(args).toContain("--backup");
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

    expect(logger.dimLogs).toContain("stdout-line");
    expect(logger.warnLogs).toContain("stderr-line");
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
