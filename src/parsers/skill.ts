import { readdirSync } from "node:fs";
import { join } from "node:path";

import matter from "gray-matter";

import { SkillFrontmatterSchema, type SkillFrontmatter } from "../schema.js";
import type { DiagnosticOrigin } from "../types.js";
import { fileExists, readFile } from "../utils/fs.js";
import { ParseError } from "./_shared.js";

export interface ParsedSkill {
  name: string; // directory name
  dir: string; // absolute path to skill directory
  frontmatter: SkillFrontmatter;
  body: string; // SKILL.md content after frontmatter
  origin?: DiagnosticOrigin;
}

export type SkillPlatform = "claude" | "opencode" | "codex" | "cursor" | "forgecode";

/** Filter skills that are not explicitly disabled for the given platform. */
export function enabledSkillsFor(skills: readonly ParsedSkill[], platform: SkillPlatform): readonly ParsedSkill[] {
  return skills.filter((s) => s.frontmatter?.platforms?.[platform]?.enabled !== false);
}

/** Internal: collects all skill parse results without throwing. Used by parseProject. */
export function collectSkills(
  skillsDir: string,
  opts: { readonly sourceDir?: string; readonly source?: string } = {},
): { items: readonly ParsedSkill[]; errors: readonly ParseError[] } {
  if (!fileExists(skillsDir)) return { items: [], errors: [] };
  const entries = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  const skills: ParsedSkill[] = [];
  const errors: ParseError[] = [];

  for (const entry of entries) {
    const skillDir = join(skillsDir, entry.name);
    const skillFile = join(skillDir, "SKILL.md");
    const relativeFile = `skills/${entry.name}/SKILL.md`;
    if (!fileExists(skillFile)) continue;
    let raw: string | undefined;
    try {
      raw = readFile(skillFile);
      const { data, content } = matter(raw);
      const frontmatter = SkillFrontmatterSchema.parse(data);
      if (frontmatter?.name !== entry.name) {
        throw new Error(`frontmatter name '${frontmatter?.name}' must match directory '${entry.name}'`);
      }
      skills.push({
        name: entry.name,
        dir: skillDir,
        frontmatter,
        body: content.trim(),
        origin: {
          source: opts.source ?? "base",
          relativeFile,
          absoluteFile: skillFile,
          target: "all",
        },
      });
    } catch (err) {
      errors.push(
        new ParseError("skill", relativeFile, err, {
          source: opts.source,
          sourceDir: opts.sourceDir,
          relativeFile,
          absoluteFile: skillFile,
          content: raw ? frontmatterContent(raw) : undefined,
          lineOffset: 2,
          parserLineOffset: 1,
        }),
      );
    }
  }

  return { items: skills, errors };
}

function frontmatterContent(raw: string): string | undefined {
  if (!raw.startsWith("---")) return undefined;
  const firstNewline = raw.indexOf("\n");
  if (firstNewline < 0) return undefined;
  const end = raw.indexOf("\n---", firstNewline + 1);
  if (end < 0) return raw.slice(firstNewline + 1);
  return raw.slice(firstNewline + 1, end);
}

/**
 * Parse and validate all skill directories containing `SKILL.md`.
 */
export function parseSkills(skillsDir: string): readonly ParsedSkill[] {
  const { items, errors } = collectSkills(skillsDir);
  if (errors.length > 0) throw errors[0] as ParseError;
  return items;
}
