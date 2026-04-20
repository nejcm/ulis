import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { runInstall } from "../install.js";
import { PLATFORMS, type Platform } from "../platforms.js";
import { log } from "../utils/logger.js";
import { resolveSource } from "../utils/resolve-source.js";
import { parseTargets, type BuildCmdOptions } from "./build.js";

export interface InstallCmdOptions extends BuildCmdOptions {
  readonly yes?: boolean;
  readonly backup?: boolean;
  readonly rebuild?: boolean;
}

export async function installCmd(options: InstallCmdOptions = {}): Promise<void> {
  const { sourceDir, destBase } = resolveSource({ global: options.global, source: options.source });
  const targets = parseTargets(options) ?? PLATFORMS;

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
    platforms: targets,
    backup: options.backup ?? false,
    rebuild: options.rebuild ?? true,
    logger: log,
  });
}

function detectCollisions(destBase: string, targets: readonly Platform[]): string[] {
  const paths: string[] = [];
  for (const platform of targets) {
    const dir = join(destBase, `.${platform}`);
    if (existsSync(dir)) {
      try {
        if (readdirSync(dir).length > 0) paths.push(dir);
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
