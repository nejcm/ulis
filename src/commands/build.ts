import { runBuild } from "../build.js";
import type { TargetOptionInput } from "../build.js";
import { parsePlatformList, type Platform } from "../platforms.js";
import { createInterruptGuard } from "../utils/interrupt.js";
import { logger as log } from "../utils/logger.js";
import { isRemoteSource, parseRepoUrl } from "../utils/remote-source.js";
import { parsePresetNames, resolvePresets } from "../utils/resolve-presets.js";
import { resolveSource } from "../utils/resolve-source.js";

export interface BuildCmdOptions extends TargetOptionInput {
  readonly global?: boolean;
  readonly source?: string;
  readonly preset?: string | string[];
}

/**
 * Resolve source/targets and execute a build run.
 */
export async function buildCmd(options: BuildCmdOptions = {}): Promise<void> {
  if (options.source && isRemoteSource(options.source)) {
    // Reject an unsupported protocol here rather than sending the user to `install` for a URL
    // install would refuse too.
    parseRepoUrl(options.source);
    // Nothing is cloned yet, so there is nothing to clean up - reject before any work.
    throw new Error(
      "build writes generated output into the source tree, and a remote source is discarded after the run. " +
        "Use `ulis install --source <url>` instead.",
    );
  }

  const { sourceDir } = resolveSource({ global: options.global, source: options.source });
  const targets = parseTargets(options);
  const nonInteractive = process.env.ULIS_NON_INTERACTIVE === "1" || process.stdin.isTTY !== true;
  const presetNames = options.preset ? parsePresetNames(options.preset) : [];
  // `--source` is never remote here, but `--preset <url>` still clones. Without the guard a Ctrl-C
  // kills the process before the `finally` runs and leaves the clone on disk.
  const guard = createInterruptGuard(presetNames.some(isRemoteSource));

  try {
    const { presets, cleanup } = await guard.track(() =>
      resolvePresets(presetNames, { nonInteractive, logger: log, signal: guard.signal }),
    );
    guard.onCleanup(cleanup);

    runBuild({ sourceDir, targets, logger: log, presets });
  } finally {
    guard.release();
  }
}

/**
 * Parse `--target/--targets` values into deduplicated platform identifiers.
 */
export function parseTargets(options: TargetOptionInput): readonly Platform[] | undefined {
  const raw = options.target ?? options.targets;
  if (raw === undefined) return undefined;
  const list = Array.isArray(raw) ? raw : [raw];
  return parsePlatformList(list);
}
