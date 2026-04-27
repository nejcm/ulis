import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { ULIS_PRESETS_DIRNAME, ULIS_SOURCE_DIRNAME } from "../config.js";
import { PresetMetaSchema } from "../schema.js";
import { loadConfigFile } from "../utils/config-loader.js";
import { logger as log } from "../utils/logger.js";

export async function presetListCmd(): Promise<void> {
  const presetsRoot = join(homedir(), ULIS_SOURCE_DIRNAME, ULIS_PRESETS_DIRNAME);

  if (!existsSync(presetsRoot)) {
    log.info(`No presets directory found at ${presetsRoot}`);
    log.info(`Create it with: mkdir -p ${presetsRoot}/<preset-name>`);
    return;
  }

  let entries: string[];
  try {
    entries = readdirSync(presetsRoot).filter((entry) => {
      try {
        return statSync(join(presetsRoot, entry)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch (err) {
    throw new Error(`Failed to read presets directory ${presetsRoot}: ${(err as Error).message}`);
  }

  if (entries.length === 0) {
    log.info(`No presets found in ${presetsRoot}`);
    return;
  }

  log.header("Available Presets");

  for (const folderName of entries.sort()) {
    const presetDir = join(presetsRoot, folderName);
    const raw = loadConfigFile(presetDir, "preset");
    const meta = raw != null ? PresetMetaSchema.safeParse(raw) : null;
    const displayName = meta?.success && meta.data.name ? meta.data.name : folderName;
    const description = meta?.success && meta.data.description ? `  ${meta.data.description}` : "";
    const label = displayName !== folderName ? `${folderName} (${displayName})` : folderName;
    log.info(`  ${label}${description}`);
  }
}
