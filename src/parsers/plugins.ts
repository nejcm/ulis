import { PluginsConfigSchema, type PluginsConfig } from "../schema.js";
import { loadConfigFile } from "../utils/config-loader.js";

/**
 * Load and validate the plugins config (yaml or json) from `sourceDir`.
 * Returns an empty object if no plugins file exists.
 */
export function loadPlugins(sourceDir: string): PluginsConfig {
  const raw = loadConfigFile(sourceDir, "plugins");
  if (raw === undefined) return {};
  return PluginsConfigSchema.parse(raw);
}
