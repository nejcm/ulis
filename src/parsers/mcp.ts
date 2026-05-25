import { McpConfigSchema, type McpConfig } from "../schema.js";
import type { ConfigDiagnosticOptions } from "../utils/config-loader.js";
import { loadValidatedConfigFile } from "../utils/config-loader.js";

/**
 * Load and validate the mcp config (yaml or json) from `sourceDir`.
 * Returns an empty config when no file exists.
 */
export function loadMcp(sourceDir: string, diagnostic?: ConfigDiagnosticOptions): McpConfig {
  return loadValidatedConfigFile({
    dir: sourceDir,
    baseName: "mcp",
    schema: McpConfigSchema,
    defaultValue: { servers: {} },
    diagnostic,
  });
}
