import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { runInstall } from "../install.js";
import { PLATFORMS, platformConfigDir, type Platform } from "../platforms.js";
import { logger as log } from "../utils/logger.js";
import { parsePresetNames, resolvePresets } from "../utils/resolve-presets.js";
import { resolveSource } from "../utils/resolve-source.js";
import { parseTargets, type BuildCmdOptions } from "./build.js";

export interface InstallCmdOptions extends BuildCmdOptions {
  readonly yes?: boolean;
  readonly backup?: boolean;
  readonly rebuild?: boolean;
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

  const collisions = detectCollisions(destBase, targets);
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

  runInstall({
    sourceDir,
    destBase,
    globalInstall: mode === "global",
    platforms: targets,
    backup: options.backup ?? false,
    rebuild: options.rebuild ?? true,
    logger: log,
    presets,
  });
}

// TODO: improve this function
function detectCollisions(destBase: string, targets: readonly Platform[]): string[] {
  const paths: string[] = [];
  for (const platform of targets) {
    if (platform === "claude") {
      const rootConfigPath = join(destBase, ".claude.json");
      if (existsSync(rootConfigPath)) {
        paths.push(rootConfigPath);
      }
    }

    if (platform === "forgecode") {
      const forgeDir = platformConfigDir(platform, destBase);
      if (existsSync(forgeDir)) {
        try {
          if (readdirSync(forgeDir).length > 0) paths.push(forgeDir);
        } catch {
          // ignore
        }
      }
      const mcpPath = join(forgeDir, ".mcp.json");
      if (existsSync(mcpPath)) {
        paths.push(mcpPath);
      }
      continue;
    }

    const platformDir = platformConfigDir(platform, destBase);
    if (existsSync(platformDir)) {
      try {
        if (readdirSync(platformDir).length > 0) paths.push(platformDir);
      } catch {
        // ignore
      }
    }
  }
  return paths;
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
