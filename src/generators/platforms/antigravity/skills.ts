import type { ParsedSkill } from "../../../parsers/skill.js";
import type { PostEmit } from "../../types.js";

export function buildAntigravitySkillDirs(skills: readonly ParsedSkill[]): PostEmit["skillDirs"] {
  return skills.map((s) => {
    const { enabled: _e, ...extra } = (s.frontmatter?.platforms?.antigravity ?? {}) as Record<string, unknown>;
    return { name: s.name, dir: s.dir, extraFrontmatter: extra, stripKeys: ["model"] };
  });
}
