import { join } from "node:path";

import { PresetMetaSchema } from "../schema.js";
import { loadConfigFile } from "../utils/config-loader.js";
import { logger as log } from "../utils/logger.js";
import { bundledPresetsRoot, listPresetDirectories, userPresetsRoot } from "../utils/resolve-presets.js";

interface PresetListOptions {
  readonly presetsRoot?: string;
  readonly bundledPresetsRoot?: string;
}

export async function presetListCmd(options: PresetListOptions = {}): Promise<void> {
  const presetsRoot = userPresetsRoot(options.presetsRoot);
  const bundledRoot = bundledPresetsRoot(options.bundledPresetsRoot);

  const userEntries = listPresetDirectories(presetsRoot);
  const bundledEntries = listPresetDirectories(bundledRoot);
  const entries = new Set<string>([...bundledEntries, ...userEntries]);

  if (entries.size === 0) {
    log.info(`No user-global or bundled presets found.`);
    log.info(`Create it with: mkdir -p ${presetsRoot}/<preset-name>`);
    return;
  }

  log.header("Available Presets");

  for (const folderName of [...entries].sort()) {
    const hasUserPreset = userEntries.includes(folderName);
    const presetDir = join(hasUserPreset ? presetsRoot : bundledRoot, folderName);
    const raw = loadConfigFile(presetDir, "preset");
    const meta = raw != null ? PresetMetaSchema.safeParse(raw) : null;
    const displayName = meta?.success && meta.data.name ? meta.data.name : folderName;
    const description = meta?.success && meta.data.description ? `  ${meta.data.description}` : "";
    const source = hasUserPreset ? "user" : "bundled";
    const label =
      displayName !== folderName ? `${folderName} (${displayName}, ${source})` : `${folderName} (${source})`;
    log.info(`  ${label}${description}`);
  }
}
