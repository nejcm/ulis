import type { spawnSync } from "node:child_process";

import { sanitizeLogText } from "./redact.js";

type SpawnSync = (
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawnSync>[2],
) => { status: number | null };

/**
 * True when `command` resolves on `PATH`.
 * `run` is injectable so callers can route the probe through their own (mockable) spawn.
 */
export function commandExists(command: string, run: SpawnSync): boolean {
  const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
  return run(lookupCommand, [command], { stdio: "ignore" }).status === 0;
}

/**
 * Characters `cmd.exe` acts on: command separators, redirection, the escape character, quotes,
 * variable expansion, and grouping. Parentheses and `!` are only special in some contexts, but a
 * package name has no use for any of these, so the strict set is the cheap one.
 */
const CMD_METACHARACTERS = /[&|<>^"%!()\r\n]/u;

/**
 * Whitespace is not a metacharacter but breaks the same promise: Node concatenates argv with spaces,
 * so `--flag=a b` arrives as two arguments while the trust preview renders it as one quoted token.
 */
const ARG_WHITESPACE = /\s/u;

/**
 * Refuse an argv that `cmd.exe` would reinterpret.
 *
 * `spawn(..., { shell: true })` on Windows concatenates the arguments into one command line instead
 * of escaping them (Node's own DEP0190 warns about exactly this), so a manifest entry named
 * `pkg & calc` runs a second command. Remote sources make that argv attacker-controlled, and the
 * trust preview renders such a value as a single quoted argument — so the user would approve one
 * command and get two. Refusing is the honest outcome: there is no legitimate package name here
 * that needs a metacharacter, and quoting for `cmd.exe` correctly is notoriously hard to get right.
 *
 * Only applies where a shell is actually involved; the POSIX path passes argv straight to `execvp`.
 */
export function assertShellSafeArgv(argv: readonly string[]): void {
  const offending = argv.find((token) => CMD_METACHARACTERS.test(token) || ARG_WHITESPACE.test(token));
  if (offending !== undefined) {
    throw new Error(
      `Refusing to run a command containing shell metacharacters or spaces: ${sanitizeLogText(offending)}. ` +
        "Remove them from the skill or extension entry; a spaced argument goes in separate entries.",
    );
  }
}
