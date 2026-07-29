import { homedir } from "node:os";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { runPresetInstall } from "../install.js";
import { detectInstallCollisions } from "../install/platforms.js";
import { PLATFORMS } from "../platforms.js";
import { listPresets } from "../presets.js";
import { logger as log } from "../utils/logger.js";
import { parsePresetNames, resolvePresets, userPresetsRoot } from "../utils/resolve-presets.js";
import { parseTargets } from "./build.js";

const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

interface PresetListOptions {
  readonly presetsRoot?: string;
  readonly bundledPresetsRoot?: string;
}

export interface PresetInstallCmdOptions {
  readonly global?: boolean;
  readonly yes?: boolean;
  readonly target?: string | string[];
  readonly backup?: boolean;
  readonly prune?: boolean;
  readonly runner?: "npx" | "bunx";
  readonly extensions?: boolean;
  readonly skipExternalSkills?: boolean;
  readonly presetsRoot?: string;
  readonly bundledPresetsRoot?: string;
  readonly userHome?: string;
}

export async function presetListCmd(options: PresetListOptions = {}): Promise<void> {
  const presetsRoot = userPresetsRoot(options.presetsRoot);
  const entries = listPresets(options);

  if (entries.length === 0) {
    log.info(`No user-global or bundled presets found.`);
    log.info(`Create it with: mkdir -p ${presetsRoot}/<preset-name>`);
    return;
  }

  log.header("Available Presets");

  for (const entry of entries) {
    const description = entry.description ? `  ${entry.description}` : "";
    const metaLabel = entry.displayName !== entry.name ? `${entry.displayName}, ${entry.source}` : entry.source;
    console.log(`  ${CYAN}${entry.name}${RESET} ${DIM}(${metaLabel})${RESET}${description}`);
  }
}

export async function presetInstallCmd(
  names: string | readonly string[] | undefined,
  options: PresetInstallCmdOptions = {},
): Promise<void> {
  const presetNames = names == null ? [] : parsePresetNames(names);
  if (presetNames.length === 0) {
    throw new Error("Select at least one preset to install.");
  }

  const targets = parseTargets(options) ?? PLATFORMS;
  const userHome = options.userHome ?? homedir();
  const destBase = options.global ? userHome : process.cwd();
  const presets = await resolvePresets(presetNames, {
    nonInteractive: options.yes ?? false,
    presetsRoot: options.presetsRoot,
    bundledPresetsRoot: options.bundledPresetsRoot,
  });

  const collisions = detectInstallCollisions(destBase, targets, Boolean(options.global), userHome);
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

  await runPresetInstall({
    destBase,
    globalInstall: Boolean(options.global),
    platforms: targets,
    backup: options.backup ?? false,
    prune: options.prune ?? true,
    logger: log,
    presets,
    runner: options.runner,
    installExtensions: options.extensions ?? true,
    installSkills: !options.skipExternalSkills,
    userHome,
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
