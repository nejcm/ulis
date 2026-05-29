import { homedir } from "node:os";
import { join } from "node:path";

import { ULIS_PRESETS_DIRNAME, ULIS_SOURCE_DIRNAME } from "../config.js";
import type { PresetListEntry } from "../presets.js";
import { PresetMetaSchema } from "../schema.js";
import { loadConfigFile } from "../utils/config-loader.js";
import { bundledPresetsRoot, listPresetDirectories } from "../utils/resolve-presets.js";

interface TuiPresetListOptions {
  readonly cwd?: string;
  readonly userHome?: string;
  readonly bundledRoot?: string;
}

export function listTuiPresets(options: TuiPresetListOptions = {}): readonly PresetListEntry[] {
  const cwd = options.cwd ?? process.cwd();
  const userHome = options.userHome ?? homedir();
  return [
    ...listPresetRoot(join(cwd, ULIS_SOURCE_DIRNAME, ULIS_PRESETS_DIRNAME), "project"),
    ...listPresetRoot(join(userHome, ULIS_SOURCE_DIRNAME, ULIS_PRESETS_DIRNAME), "global"),
    ...listPresetRoot(bundledPresetsRoot(options.bundledRoot), "bundled"),
  ];
}

function listPresetRoot(root: string, source: PresetListEntry["source"]): readonly PresetListEntry[] {
  return listPresetDirectories(root)
    .slice()
    .sort()
    .map((folderName) => presetListEntry(root, source, folderName));
}

function presetListEntry(root: string, source: PresetListEntry["source"], folderName: string): PresetListEntry {
  const dir = join(root, folderName);
  const raw = loadConfigFile(dir, "preset");
  const meta = raw != null ? PresetMetaSchema.safeParse(raw) : null;
  return {
    name: folderName,
    displayName: meta?.success && meta.data.name ? meta.data.name : folderName,
    description: meta?.success && meta.data.description ? meta.data.description : "",
    source,
    dir,
  };
}
