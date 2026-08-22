import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { InstallError } from "./errors.js";

/**
 * Variables that steer how a child process finds, fetches and loads code. A remote `.env` is attacker-
 * controlled, so setting one of these would hijack the very `npx`/`bunx` command the user approved.
 * Local sources keep the old behaviour.
 *
 * `HOME`/`USERPROFILE` are here because they relocate where `npx`/`bunx` read `.npmrc` and
 * `.bunfig.toml` (as does `XDG_CONFIG_HOME` on Linux), and `script-shell=` in an `.npmrc` is a
 * code-execution primitive; `ComSpec` is the
 * shell Node launches for `spawn({ shell: true })` on Windows; `SSH_ASKPASS`/`SSH_AUTH_SOCK` are the
 * ssh-side hole next to the `GIT_*` ones.
 */
const UNTRUSTED_ENV_DENYLIST =
  /^(?:PATH|HOME|USERPROFILE|XDG_CONFIG_HOME|ComSpec|NODE_.*|npm_.*|BUN_.*|LD_.*|DYLD_.*|GIT_.*|SSH_.*|(?:HTTP|HTTPS|ALL|NO)_PROXY)$/iu;

/**
 * Load environment variables from `<rootDir>/.env` without overriding existing values.
 * `untrusted` marks a remote source, whose `.env` may not set {@link UNTRUSTED_ENV_DENYLIST} keys.
 */
export function loadDotEnv(
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env,
  options: { readonly untrusted?: boolean } = {},
): void {
  const envPath = join(rootDir, ".env");
  if (!existsSync(envPath)) {
    return;
  }

  let lines: readonly string[];
  try {
    lines = readFileSync(envPath, "utf8").split(/\r?\n/u);
  } catch (error) {
    throw new InstallError(`Failed to read .env file at ${envPath}`, error);
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!key || key in env || (options.untrusted && UNTRUSTED_ENV_DENYLIST.test(key))) {
      continue;
    }

    const hasMatchingQuotes =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"));
    env[key] = hasMatchingQuotes ? rawValue.slice(1, -1) : rawValue;
  }
}
