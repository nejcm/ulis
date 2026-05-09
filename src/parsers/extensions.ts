import { ExtensionsConfigSchema, type ExtensionsConfig } from "../schema.js";
import { loadConfigFile, parseConfigOrThrow, resolveLoadedConfigPath } from "../utils/config-loader.js";

const EXTENSION_CONFIG_KEYS = ["*", "claude", "opencode", "codex", "cursor", "forgecode"] as const;

/**
 * Load and validate the extensions config (yaml or json) from `sourceDir`.
 * Missing file or an empty YAML document validates as an empty config.
 */
export function loadExtensions(sourceDir: string): ExtensionsConfig {
  const raw = loadConfigFile(sourceDir, "extensions");
  const filePath = resolveLoadedConfigPath(sourceDir, "extensions");
  return parseConfigOrThrow(ExtensionsConfigSchema, raw, "extensions", filePath);
}

/**
 * Merge extensions configs in install order. Arrays concatenate so presets can
 * contribute reusable installs without hiding project-local extensions.
 */
export function mergeExtensionsConfigs(configs: readonly ExtensionsConfig[]): ExtensionsConfig {
  const merged: ExtensionsConfig = {};

  for (const config of configs) {
    for (const key of EXTENSION_CONFIG_KEYS) {
      const extensions = config[key]?.extensions ?? [];
      if (extensions.length === 0) continue;

      merged[key] = {
        extensions: [...(merged[key]?.extensions ?? []), ...extensions],
      };
    }
  }

  return merged;
}
