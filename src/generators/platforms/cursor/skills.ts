import type { ParsedSkill } from "../../../parsers/skill.js";
import type { PostEmit } from "../../types.js";

export function buildCursorSkillDirs(skills: readonly ParsedSkill[]): PostEmit["skillDirs"] {
  return skills.map((s) => {
    const p = s.frontmatter?.platforms?.cursor;
    const { enabled: _e, model: _m, ...extra } = (p ?? {}) as Record<string, unknown>;
    const model = p?.model ?? s.frontmatter?.model;
    return { name: s.name, dir: s.dir, extraFrontmatter: { ...(model ? { model } : {}), ...extra } };
  });
}
