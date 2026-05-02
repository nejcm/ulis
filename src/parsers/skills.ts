import { SkillsConfigSchema, type SkillsConfig } from "../schema.js";
import { loadConfigFile, parseConfigOrThrow, resolveLoadedConfigPath } from "../utils/config-loader.js";

const SKILL_CONFIG_KEYS = ["*", "claude", "opencode", "codex", "cursor", "forgecode"] as const;

/**
 * Load and validate the skills config (yaml or json) from `sourceDir`.
 * Missing file or an empty YAML document validates as an empty config.
 */
export function loadSkills(sourceDir: string): SkillsConfig {
  const raw = loadConfigFile(sourceDir, "skills");
  const filePath = resolveLoadedConfigPath(sourceDir, "skills");
  return parseConfigOrThrow(SkillsConfigSchema, raw, "skills", filePath);
}

/**
 * Merge skills configs in install order. Arrays concatenate so presets can
 * contribute reusable installs without hiding project-local skills.
 */
export function mergeSkillsConfigs(configs: readonly SkillsConfig[]): SkillsConfig {
  const merged: SkillsConfig = {};

  for (const config of configs) {
    for (const key of SKILL_CONFIG_KEYS) {
      const skills = config[key]?.skills ?? [];
      if (skills.length === 0) continue;

      merged[key] = {
        skills: [...(merged[key]?.skills ?? []), ...skills],
      };
    }
  }

  return merged;
}
