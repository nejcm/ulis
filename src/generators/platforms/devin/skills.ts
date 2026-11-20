import type { ParsedSkill } from "../../../parsers/skill.js";
import type { PostEmit } from "../../types.js";

export function buildDevinSkillDirs(skills: readonly ParsedSkill[]): PostEmit["skillDirs"] {
  return skills.map((s) => {
    const { enabled: _e, ...extra } = (s.frontmatter?.platforms?.devin ?? {}) as Record<string, unknown>;
    return { name: s.name, dir: s.dir, extraFrontmatter: extra, stripKeys: ["model", "allowed-tools"] };
  });
}
