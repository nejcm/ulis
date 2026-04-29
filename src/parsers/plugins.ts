import { PluginsConfigSchema, type PluginsConfig } from "../schema.js";
import { loadValidatedConfigFile } from "../utils/config-loader.js";

/**
 * Load and validate the plugins config (yaml or json) from `sourceDir`.
 * Returns an empty object if no plugins file exists.
 */
export function loadPlugins(sourceDir: string): PluginsConfig {
  return loadValidatedConfigFile({
    dir: sourceDir,
    baseName: "plugins",
    schema: PluginsConfigSchema,
    defaultValue: {},
  });
}
