import { readdirSync } from "node:fs";
import { join } from "node:path";

import matter from "gray-matter";

import { SkillFrontmatterSchema, type SkillFrontmatter } from "../schema.js";
import { readFile, fileExists } from "../utils/fs.js";

export interface ParsedSkill {
  name: string; // directory name
  dir: string; // absolute path to skill directory
  frontmatter: SkillFrontmatter;
  body: string; // SKILL.md content after frontmatter
}

export type SkillPlatform = "claude" | "opencode" | "codex" | "cursor" | "forgecode";

/** Filter skills that are not explicitly disabled for the given platform. */
export function enabledSkillsFor(skills: readonly ParsedSkill[], platform: SkillPlatform): readonly ParsedSkill[] {
  return skills.filter((s) => s.frontmatter.platforms?.[platform]?.enabled !== false);
}

export function parseSkills(skillsDir: string): readonly ParsedSkill[] {
  if (!fileExists(skillsDir)) return [];
  const entries = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  const skills: ParsedSkill[] = [];
  for (const entry of entries) {
    const skillDir = join(skillsDir, entry.name);
    const skillFile = join(skillDir, "SKILL.md");
    if (!fileExists(skillFile)) continue;
    const raw = readFile(skillFile);
    const { data, content } = matter(raw);
    const frontmatter = SkillFrontmatterSchema.parse(data);
    if (frontmatter.name !== entry.name) {
      throw new Error(
        `Skill name mismatch in ${skillFile}: frontmatter name '${frontmatter.name}' must match directory '${entry.name}'`,
      );
    }
    skills.push({
      name: entry.name,
      dir: skillDir,
      frontmatter,
      body: content.trim(),
    });
  }
  return skills;
}
