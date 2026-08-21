import { ExtensionsConfigSchema, type Extension, type ExtensionsConfig } from "../schema.js";
import { loadValidatedConfigFile, type ConfigDiagnosticOptions } from "../utils/config-loader.js";

const EXTENSION_CONFIG_KEYS = ["*", "claude", "opencode", "codex", "cursor", "forgecode"] as const;

/**
 * Load and validate the extensions config (yaml or json) from `sourceDir`.
 * Missing file or an empty YAML document validates as an empty config.
 */
export function loadExtensions(sourceDir: string, diagnostic?: ConfigDiagnosticOptions): ExtensionsConfig {
  return loadValidatedConfigFile({
    dir: sourceDir,
    baseName: "extensions",
    schema: ExtensionsConfigSchema,
    defaultValue: {},
    diagnostic,
  });
}

/**
 * Merge a single platform's extension list across layers by identity (`key ??
 * name`): a later layer's entry with the same identity replaces an earlier
 * one outright (args included), so presets can contribute reusable installs
 * without hiding project-local extensions, and the base finally has a way to
 * override a preset's entry instead of just adding to it. Position is first
 * occurrence, matching `deduplicateByName` in merge-projects.ts. Repeats
 * within one layer collapse the same way. There is deliberately no removal
 * mechanism: a base can replace a preset's entry but cannot delete it.
 */
function mergeExtensionList(lists: readonly (readonly Extension[])[]): Extension[] {
  const seen = new Map<string, Extension>();
  for (const list of lists) {
    for (const extension of list) {
      seen.set(extension.key ?? extension.name, extension);
    }
  }
  return [...seen.values()];
}

/**
 * Merge extensions configs in install order (base last wins conflicts).
 */
export function mergeExtensionsConfigs(configs: readonly ExtensionsConfig[]): ExtensionsConfig {
  const merged: ExtensionsConfig = {};

  for (const key of EXTENSION_CONFIG_KEYS) {
    const lists = configs.map((config) => config[key]?.extensions ?? []);
    const extensions = mergeExtensionList(lists);
    if (extensions.length === 0) continue;

    merged[key] = { extensions };
  }

  return merged;
}
