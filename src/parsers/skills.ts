import { SkillsConfigSchema, type SkillsConfig } from "../schema.js";
import { loadConfigFile } from "../utils/config-loader.js";

/**
 * Load and validate the skills config (yaml or json) from `sourceDir`.
 * Returns an empty object if no skills file exists.
 */
export function loadSkills(sourceDir: string): SkillsConfig {
  const raw = loadConfigFile(sourceDir, "skills");
  if (!raw) return {};
  return SkillsConfigSchema.parse(raw);
}
