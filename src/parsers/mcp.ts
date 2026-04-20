import { McpConfigSchema, type McpConfig } from "../schema.js";
import { loadRequiredConfigFile } from "../utils/config-loader.js";

/**
 * Load and validate the mcp config (yaml or json) from `sourceDir`.
 * Throws when no file exists.
 */
export function loadMcp(sourceDir: string): McpConfig {
  const raw = loadRequiredConfigFile(sourceDir, "mcp");
  return McpConfigSchema.parse(raw);
}
