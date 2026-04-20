import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { ULIS_SOURCE_DIRNAME } from "../config.js";

export interface ResolveSourceOptions {
  /** Explicit path override. Wins over all other resolution. */
  readonly source?: string;
  /** Use the global `~/.ulis/` instead of the project-local `.ulis/`. */
  readonly global?: boolean;
  /** Current working directory. Defaults to `process.cwd()`. Used for tests. */
  readonly cwd?: string;
}

export interface ResolvedSource {
  readonly sourceDir: string;
  readonly destBase: string;
  readonly mode: "source" | "global" | "project";
}

/**
 * Resolve the ulis source directory + install destination base.
 *
 * - `--source <path>` wins; destBase is the path's parent (so install still
 *   writes to `./.claude/` etc. alongside the explicit source).
 * - `--global` → `~/.ulis/` as source, `~` as destBase.
 * - Default → `<cwd>/.ulis/` as source, cwd as destBase. Errors if missing
 *   (no walk-up — the user must run from the project root).
 */
export function resolveSource(options: ResolveSourceOptions = {}): ResolvedSource {
  const cwd = options.cwd ?? process.cwd();

  if (options.source) {
    const sourceDir = resolve(options.source);
    if (!existsSync(sourceDir)) {
      throw new Error(`--source path does not exist: ${sourceDir}`);
    }
    // For explicit source overrides, install alongside (parent dir).
    const destBase = resolve(join(sourceDir, ".."));
    return { sourceDir, destBase, mode: "source" };
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
