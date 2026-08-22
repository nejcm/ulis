import { spawn, spawnSync } from "node:child_process";

import { commandExists as commandExistsOnPath, assertShellSafeArgv } from "../utils/command.js";
import { sanitizeLogText } from "../utils/redact.js";
import { InstallError } from "./errors.js";
import { formatCommandPreview } from "./preview.js";
import { runtimeDependencies } from "./runtime.js";
import type { AsyncCommandResult, Runner as InstallRunner } from "./types.js";

/**
 * Resolve which package runner to use for `extensions.yaml` entries.
 * Precedence: CLI flag → config.yaml → auto-detect (`bunx` if present, else `npx`).
 */
export function resolveRunner({
  cliFlag,
  configValue,
  hasCommand = commandExists,
}: {
  cliFlag?: InstallRunner;
  configValue?: InstallRunner;
  hasCommand?: (cmd: string) => boolean;
}): InstallRunner {
  if (cliFlag) return cliFlag;
  if (configValue) return configValue;
  return hasCommand("bunx") ? "bunx" : "npx";
}

/** {@link commandExistsOnPath}, bound to this module's mockable spawn. */
export function commandExists(command: string): boolean {
  return commandExistsOnPath(command, runCommand);
}

export function resolveExecutable(command: string): string {
  if (process.platform === "win32" && (command === "npx" || command === "bunx")) {
    return `${command}.cmd`;
  }
  return command;
}

export function formatCommandFailure(result: {
  stdout?: unknown;
  stderr?: unknown;
  status?: unknown;
  error?: Error;
}): string {
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const combined = `${stdout}\n${stderr}`
    // oxlint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/gu, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  // Child output is untrusted: it can echo a credentialed URL back, or carry terminal controls.
  return sanitizeLogText(combined[combined.length - 1] || result.error?.message || `exit ${result.status}`);
}

export function makeTimestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(
    now.getMinutes(),
  )}${pad(now.getSeconds())}`;
}

export function runCommand(command: string, args: readonly string[], options: Parameters<typeof spawnSync>[2]) {
  try {
    return runtimeDependencies.runCommand(command, args, options);
  } catch (error) {
    throw new InstallError(`Failed to run command: ${formatCommandPreview([command, ...args])}`, error);
  }
}

export async function runSkillCommand(
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawn>[2],
): Promise<AsyncCommandResult> {
  // The one place every skill, extension and clone launch passes through, so the shell check
  // belongs here rather than at each caller. `.cmd` shims force `shell: true` on Windows, which
  // means argv is concatenated rather than escaped — see {@link assertShellSafeArgv}.
  if (options?.shell) assertShellSafeArgv([command, ...args]);
  try {
    return await runtimeDependencies.runAsyncCommand(command, args, options);
  } catch (error) {
    throw new InstallError(`Failed to run command: ${formatCommandPreview([command, ...args])}`, error);
  }
}

export function runAsyncCommand(
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawn>[2],
): Promise<AsyncCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], options);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer | string) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk: Buffer | string) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      resolve({
        status: 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        error,
      });
    });
    child.on("close", (status) => {
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
