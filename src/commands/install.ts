import { runInstall } from "../install.js";
import { detectInstallCollisions } from "../install/platforms.js";
import { PLATFORMS } from "../platforms.js";
import { createInterruptGuard } from "../utils/interrupt.js";
import { logger as log } from "../utils/logger.js";
import { confirm } from "../utils/prompt.js";
import { redactUserinfo } from "../utils/redact.js";
import { isRemoteSource } from "../utils/remote-source.js";
import { parsePresetNames, resolvePresets } from "../utils/resolve-presets.js";
import { resolveSourceOrRemote } from "../utils/resolve-source.js";
import { parseTargets, type BuildCmdOptions } from "./build.js";

export interface InstallCmdOptions extends BuildCmdOptions {
  readonly yes?: boolean;
  readonly backup?: boolean;
  readonly prune?: boolean;
  readonly rebuild?: boolean;
  readonly runner?: "npx" | "bunx";
  readonly extensions?: boolean;
  readonly skipExternalSkills?: boolean;
  /** Home directory override. Defaults to `os.homedir()`. Used for tests. */
  readonly homeDir?: string;
}

/**
 * Detect destination collisions, optionally confirm, then install generated configs.
 */
export async function installCmd(options: InstallCmdOptions = {}): Promise<void> {
  const presetNames = options.preset ? parsePresetNames(options.preset) : [];
  const guard = createInterruptGuard(
    (options.source != null && isRemoteSource(options.source)) || presetNames.some(isRemoteSource),
  );

  try {
    const resolved = await guard.track(() =>
      resolveSourceOrRemote({
        global: options.global,
        homeDir: options.homeDir,
        source: options.source,
        logger: log,
        signal: guard.signal,
      }),
    );
    const { sourceDir, destBase, mode } = resolved;
    guard.onCleanup(resolved.cleanup);
    // The temp directory is meaningless to the user; name the repository instead - minus any
    // credentials the URL carried.
    const remoteLabel = mode === "remote" && options.source ? redactUserinfo(options.source) : undefined;

    const targets = parseTargets(options) ?? PLATFORMS;
    const { presets, cleanup: cleanupPresets } = await guard.track(() =>
      resolvePresets(presetNames, {
        nonInteractive: options.yes ?? false,
        logger: log,
        signal: guard.signal,
      }),
    );
    guard.onCleanup(cleanupPresets);

    // `--global` forces global skill scope. Otherwise runInstall derives it from the destination
    // layout, including the case where a project destination is the user home.
    const globalInstall = options.global === true ? true : undefined;
    const collisions = detectInstallCollisions(destBase, targets, options.homeDir);
    if (collisions.length > 0 && !options.yes) {
      log.warn("The following folders already exist and will be modified/overwritten:");
      for (const path of collisions) {
        log.dim(`  - ${path}`);
      }
      const confirmed = await confirm("Continue?");
      if (!confirmed) {
        // Thrown rather than returned: a declined prompt is exit code 1 (see docs/CLI.md), and a
        // closed stdin declines, so a scripted run must not read as a successful install.
        throw new Error("Aborted by user.");
      }
    }

    await guard.track(() =>
      runInstall({
        sourceDir,
        sourceLabel: remoteLabel,
        sourceIsRemote: mode === "remote",
        destBase,
        userHome: options.homeDir,
        globalInstall,
        platforms: targets,
        backup: options.backup ?? false,
        prune: options.prune ?? true,
        rebuild: options.rebuild ?? true,
        logger: log,
        presets,
        runner: options.runner,
        installExtensions: options.extensions ?? true,
        installSkills: !options.skipExternalSkills,
        remoteSources: [
          ...(remoteLabel ? [remoteLabel] : []),
          ...presets.flatMap((preset) => (preset.remoteUrl ? [preset.remoteUrl] : [])),
        ],
        nonInteractive: options.yes ?? false,
        signal: guard.signal,
      }),
    );
  } finally {
    guard.release();
  }
}
