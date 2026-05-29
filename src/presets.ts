import { join } from "node:path";

import { PresetMetaSchema } from "./schema.js";
import { loadConfigFile } from "./utils/config-loader.js";
import { bundledPresetsRoot, listPresetDirectories, userPresetsRoot } from "./utils/resolve-presets.js";

export interface PresetListOptions {
  readonly presetsRoot?: string;
  readonly bundledPresetsRoot?: string;
}

export interface PresetListEntry {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly source: "user" | "project" | "global" | "bundled";
  readonly dir: string;
}

export function listPresets(options: PresetListOptions = {}): readonly PresetListEntry[] {
  const presetsRoot = userPresetsRoot(options.presetsRoot);
  const bundledRoot = bundledPresetsRoot(options.bundledPresetsRoot);
  const userEntries = listPresetDirectories(presetsRoot);
  const bundledEntries = listPresetDirectories(bundledRoot);
  const entries = new Set<string>([...bundledEntries, ...userEntries]);

  return [...entries].sort().map((folderName) => {
    const hasUserPreset = userEntries.includes(folderName);
    const dir = join(hasUserPreset ? presetsRoot : bundledRoot, folderName);
    const raw = loadConfigFile(dir, "preset");
    const meta = raw != null ? PresetMetaSchema.safeParse(raw) : null;
    const displayName = meta?.success && meta.data.name ? meta.data.name : folderName;
    const description = meta?.success && meta.data.description ? meta.data.description : "";

    return {
      name: folderName,
      displayName,
      description,
      source: hasUserPreset ? "user" : "bundled",
      dir,
    };
  });
}
