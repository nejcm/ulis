import { PermissionsConfigSchema, type PermissionsConfig } from "../schema.js";
import { loadConfigFile } from "../utils/config-loader.js";

/**
 * Load and validate the permissions config (yaml or json) from `sourceDir`.
 * Returns an empty object if no permissions file exists.
 */
export function loadPermissions(sourceDir: string): PermissionsConfig {
  const raw = loadConfigFile(sourceDir, "permissions");
  if (raw === undefined) return {};
  return PermissionsConfigSchema.parse(raw);
}
