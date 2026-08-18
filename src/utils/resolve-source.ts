import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { Logger } from "../build.js";
import { ULIS_SOURCE_DIRNAME } from "../config.js";
import { fetchRemoteSource, isRemoteSource } from "./remote-source.js";

export interface ResolveSourceOptions {
  /** Explicit path override for the ulis source tree. */
  readonly source?: string;
  /** Use the global `~/.ulis/` instead of the project-local `.ulis/`. */
  readonly global?: boolean;
  /** Current working directory. Defaults to `process.cwd()`. Used for tests. */
  readonly cwd?: string;
  /** Progress logger for a remote clone. Ignored by the synchronous {@link resolveSource}. */
  readonly logger?: Logger;
  /** Abort a remote clone. Ignored by the synchronous {@link resolveSource}. */
  readonly signal?: AbortSignal;
}

export interface ResolvedSource {
  readonly sourceDir: string;
  readonly destBase: string;
  readonly mode: "source" | "global" | "project" | "remote";
}

/**
 * Resolve the ulis source directory + install destination base.
 *
 * - `--source <path>` overrides the source tree.
 * - `--source <path> --global` reads the explicit source but installs to `~`.
 * - `--source <path>` without `--global` installs alongside the explicit source.
 * - `--global` → `~/.ulis/` as source, `~` as destBase.
 * - Default → `<cwd>/.ulis/` as source, cwd as destBase. Errors if missing
 *   (no walk-up — the user must run from the project root).
 */
export function resolveSource(options: ResolveSourceOptions = {}): ResolvedSource {
  const cwd = options.cwd ?? process.cwd();

  if (options.source) {
    const sourceDir = resolve(cwd, options.source);
    if (!existsSync(sourceDir)) {
      throw new Error(`--source path does not exist: ${sourceDir}`);
    }
    const destBase = options.global ? homedir() : resolve(join(sourceDir, ".."));
    return { sourceDir, destBase, mode: options.global ? "global" : "source" };
  }

  if (options.global) {
    const sourceDir = join(homedir(), ULIS_SOURCE_DIRNAME);
    if (!existsSync(sourceDir)) {
      throw new Error(`Global ulis source not found at ${sourceDir}. Run 'ulis init --global' to scaffold it.`);
    }
    return { sourceDir, destBase: homedir(), mode: "global" };
  }

  const sourceDir = join(cwd, ULIS_SOURCE_DIRNAME);
  if (!existsSync(sourceDir)) {
    throw new Error(
      `No ${ULIS_SOURCE_DIRNAME}/ folder in ${cwd}. Run 'ulis init' to scaffold one, or use '--global' / '--source <path>'.`,
    );
  }
  return { sourceDir, destBase: cwd, mode: "project" };
}

/**
 * {@link resolveSource}, plus the one case it cannot handle: a `--source` that is a git URL.
 * Clones it to a temp directory and hands back the same shape. A temp dir has no meaningful parent,
 * so `destBase` falls back to the cwd (or `~` with `--global`).
 *
 * The caller owns `cleanup` — call it in a `finally`. It is a no-op when nothing was cloned.
 */
export async function resolveSourceOrRemote(
  options: ResolveSourceOptions = {},
): Promise<ResolvedSource & { cleanup: () => void }> {
  // A no-op rather than `undefined` when nothing was cloned, matching `resolvePresets`. Callers
  // register it unconditionally instead of each re-deciding whether there is anything to clean up.
  if (!options.source || !isRemoteSource(options.source)) {
    return { ...resolveSource(options), cleanup: () => {} };
  }

  const remote = await fetchRemoteSource(options.source, { logger: options.logger, signal: options.signal });
  return {
    sourceDir: remote.dir,
    destBase: options.global ? homedir() : (options.cwd ?? process.cwd()),
    mode: "remote",
    cleanup: remote.cleanup,
  };
}
