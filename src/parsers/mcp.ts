import { McpConfigSchema, type McpConfig } from "../schema.js";
import { loadValidatedConfigFile } from "../utils/config-loader.js";

/**
 * Load and validate the mcp config (yaml or json) from `sourceDir`.
 * Throws when no file exists.
 */
export function loadMcp(sourceDir: string): McpConfig {
  return loadValidatedConfigFile({
    dir: sourceDir,
    baseName: "mcp",
    schema: McpConfigSchema,
    required: true,
  });
}
