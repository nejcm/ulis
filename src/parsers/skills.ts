import { SkillsConfigSchema, type GlobalSkill, type SkillsConfig } from "../schema.js";
import { loadValidatedConfigFile, type ConfigDiagnosticOptions } from "../utils/config-loader.js";

const SKILL_CONFIG_KEYS = ["*", "claude", "opencode", "codex", "cursor", "forgecode"] as const;

/**
 * Load and validate the skills config (yaml or json) from `sourceDir`.
 * Missing file or an empty YAML document validates as an empty config.
 */
export function loadSkills(sourceDir: string, diagnostic?: ConfigDiagnosticOptions): SkillsConfig {
  return loadValidatedConfigFile({
    dir: sourceDir,
    baseName: "skills",
    schema: SkillsConfigSchema,
    defaultValue: {},
    diagnostic,
  });
}

/**
 * Merge a single platform's skill list across layers by identity (`key ??
 * name`): a later layer's entry with the same identity replaces an earlier
 * one outright (args included), so presets can contribute reusable installs
 * without hiding project-local skills, and the base finally has a way to
 * override a preset's entry instead of just adding to it. Position is first
 * occurrence, matching `deduplicateByName` in merge-projects.ts. Repeats
 * within one layer collapse the same way. There is deliberately no removal
 * mechanism: a base can replace a preset's entry but cannot delete it.
 */
function mergeSkillList(lists: readonly (readonly GlobalSkill[])[]): GlobalSkill[] {
  const seen = new Map<string, GlobalSkill>();
  for (const list of lists) {
    for (const skill of list) {
      seen.set(skill.key ?? skill.name, skill);
    }
  }
  return [...seen.values()];
}

/**
 * Merge skills configs in install order (base last wins conflicts).
 */
export function mergeSkillsConfigs(configs: readonly SkillsConfig[]): SkillsConfig {
  const merged: SkillsConfig = {};

  for (const key of SKILL_CONFIG_KEYS) {
    const lists = configs.map((config) => config[key]?.skills ?? []);
    const skills = mergeSkillList(lists);
    if (skills.length === 0) continue;

    merged[key] = { skills };
  }

  return merged;
}
