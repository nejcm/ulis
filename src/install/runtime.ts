import { spawn, spawnSync } from "node:child_process";
import { stdin } from "node:process";

import { confirm } from "../utils/prompt.js";
import { InstallError } from "./errors.js";
// This module and runner.ts import each other, safely: both sides only read the other's export
// inside a function body, never at module-init time. It breaks the moment runner.ts reads
// runtimeDependencies at its top level, or this file calls resolveExecutable in its module body.
import { resolveExecutable, runAsyncCommand } from "./runner.js";
import type { AsyncCommandResult } from "./types.js";

type RunCommand = (
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawnSync>[2],
) => ReturnType<typeof spawnSync>;

type RunAsyncCommand = (
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawn>[2],
) => Promise<AsyncCommandResult>;

interface RuntimeDependencies {
  readonly runCommand: RunCommand;
  readonly runAsyncCommand: RunAsyncCommand;
  /** Seam for the trust gate, so tests can answer it without a terminal. */
  readonly confirm: (question: string) => Promise<boolean>;
}

const defaultRuntimeDependencies: RuntimeDependencies = {
  runCommand(command, args, options) {
    return spawnSync(command, [...args], options);
  },
  runAsyncCommand(command, args, options) {
    return runAsyncCommand(resolveExecutable(command), args, options);
  },
  confirm(question) {
    // The trust gate is a security boundary: a piped `y` must not answer it. Without a terminal the
    // question cannot be put at all, and that is a failure rather than a decision - a cron job or a
    // wrapper script that silently installed nothing and exited 0 would read as a successful run.
    // An interactive "no" is the opposite: a choice, and it exits 0. This throw is what enforces
    // that: the actionable message below is the only thing a caller ever sees.
    if (!stdin.isTTY) {
      throw new InstallError(
        "Remote source commands need confirmation, but stdin is not a terminal. " +
          "Re-run in a terminal to review them, or pass -y to accept them up front.",
      );
    }
    return confirm(question);
  },
};

let runtimeDependencies: RuntimeDependencies = { ...defaultRuntimeDependencies };

export const __test = {
  setRuntimeDependencies(overrides: Partial<RuntimeDependencies>): void {
    runtimeDependencies = { ...runtimeDependencies, ...overrides };
  },
  resetRuntimeDependencies(): void {
    runtimeDependencies = { ...defaultRuntimeDependencies };
  },
};

export type { RuntimeDependencies };
export { defaultRuntimeDependencies, runtimeDependencies };
