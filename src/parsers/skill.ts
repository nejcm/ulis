import { readdirSync } from "node:fs";
import { join } from "node:path";

import matter from "gray-matter";

import { SkillFrontmatterSchema, type SkillFrontmatter } from "../schema.js";
import { fileExists, readFile } from "../utils/fs.js";
import { ParseError } from "./_shared.js";

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

/** Internal: collects all skill parse results without throwing. Used by parseProject. */
export function collectSkills(skillsDir: string): { items: readonly ParsedSkill[]; errors: readonly ParseError[] } {
  if (!fileExists(skillsDir)) return { items: [], errors: [] };
  const entries = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  const skills: ParsedSkill[] = [];
  const errors: ParseError[] = [];

  for (const entry of entries) {
    const skillDir = join(skillsDir, entry.name);
    const skillFile = join(skillDir, "SKILL.md");
    if (!fileExists(skillFile)) continue;
    try {
      const raw = readFile(skillFile);
      const { data, content } = matter(raw);
      const frontmatter = SkillFrontmatterSchema.parse(data);
      if (frontmatter.name !== entry.name) {
        throw new Error(`frontmatter name '${frontmatter.name}' must match directory '${entry.name}'`);
      }
      skills.push({ name: entry.name, dir: skillDir, frontmatter, body: content.trim() });
    } catch (err) {
      errors.push(new ParseError("skill", `skills/${entry.name}/SKILL.md`, err));
    }
  }

  return { items: skills, errors };
}

/**
 * Parse and validate all skill directories containing `SKILL.md`.
 */
export function parseSkills(skillsDir: string): readonly ParsedSkill[] {
  const { items, errors } = collectSkills(skillsDir);
  if (errors.length > 0) throw errors[0] as ParseError;
  return items;
}
