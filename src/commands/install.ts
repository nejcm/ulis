import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { runInstall } from "../install.js";
import { detectInstallCollisions } from "../install/platforms.js";
import { PLATFORMS } from "../platforms.js";
import { logger as log } from "../utils/logger.js";
import { parsePresetNames, resolvePresets } from "../utils/resolve-presets.js";
import { resolveSource } from "../utils/resolve-source.js";
import { parseTargets, type BuildCmdOptions } from "./build.js";

export interface InstallCmdOptions extends BuildCmdOptions {
  readonly yes?: boolean;
  readonly backup?: boolean;
  readonly prune?: boolean;
  readonly rebuild?: boolean;
  readonly runner?: "npx" | "bunx";
  readonly extensions?: boolean;
  readonly skipExternalSkills?: boolean;
}

/**
 * Detect destination collisions, optionally confirm, then install generated configs.
 */
export async function installCmd(options: InstallCmdOptions = {}): Promise<void> {
  const { sourceDir, destBase, mode } = resolveSource({ global: options.global, source: options.source });
  const targets = parseTargets(options) ?? PLATFORMS;
  const presets = options.preset
    ? await resolvePresets(parsePresetNames(options.preset), { nonInteractive: options.yes ?? false })
    : [];

  const collisions = detectInstallCollisions(destBase, targets, mode === "global");
  if (collisions.length > 0 && !options.yes) {
    log.warn("The following folders already exist and will be modified/overwritten:");
    for (const path of collisions) {
      log.dim(`  - ${path}`);
    }
    const confirmed = await confirm("Continue?");
    if (!confirmed) {
      log.info("Aborted by user.");
      return;
    }
  }

  await runInstall({
    sourceDir,
    destBase,
    globalInstall: mode === "global",
    platforms: targets,
    backup: options.backup ?? false,
    prune: options.prune ?? true,
    rebuild: options.rebuild ?? true,
    logger: log,
    presets,
    runner: options.runner,
    installExtensions: options.extensions ?? true,
    installSkills: !options.skipExternalSkills,
  });
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
