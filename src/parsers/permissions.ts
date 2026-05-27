import { PermissionsConfigSchema, type PermissionsConfig } from "../schema.js";
import type { ConfigDiagnosticOptions } from "../utils/config-loader.js";
import { loadValidatedConfigFile } from "../utils/config-loader.js";

/**
 * Load and validate the permissions config (yaml or json) from `sourceDir`.
 * Returns an empty object if no permissions file exists.
 */
export function loadPermissions(sourceDir: string, diagnostic?: ConfigDiagnosticOptions): PermissionsConfig {
  return loadValidatedConfigFile({
    dir: sourceDir,
    baseName: "permissions",
    schema: PermissionsConfigSchema,
    defaultValue: {},
    diagnostic,
  });
}
