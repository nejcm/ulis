import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { applySkillFrontmatterOverrides, toPlatformSkillMarkdown } from "./skill-frontmatter.js";

export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

export function writeFile(filePath: string, content: string): void {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, content, "utf-8");
}

export function readFile(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}

export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

export function copyDir(src: string, dest: string): void {
  ensureDir(dest);
  cpSync(src, dest, { recursive: true });
}

export function cleanDir(dirPath: string): void {
  if (existsSync(dirPath)) {
    rmSync(dirPath, { recursive: true, force: true });
  }
  ensureDir(dirPath);
}

/**
 * If `outDir/AGENTS.md` exists, write alias files (e.g. CLAUDE.md) alongside
 * it that reference AGENTS.md. Existing files at those paths are left
 * untouched so platform-specific overrides win.
 */
export function writeAgentsAliases(outDir: string, aliases: readonly string[]): readonly string[] {
  const agentsPath = join(outDir, "AGENTS.md");
  if (!existsSync(agentsPath)) return [];
  const written: string[] = [];
  for (const alias of aliases) {
    const aliasPath = join(outDir, alias);
    if (existsSync(aliasPath)) continue;
    writeFile(aliasPath, `See [AGENTS.md](./AGENTS.md) for instructions.\n`);
    written.push(alias);
  }
  return written;
}

/**
 * Copy each skill's source directory into `outSkillsDir/<skill.name>`.
 * Used by generators that emit Agent Skills as plain directory copies
 * (OpenCode, Cursor).
 */
export function copySkillDirs(
  skills: ReadonlyArray<{
    readonly name: string;
    readonly dir: string;
    readonly extraFrontmatter?: Record<string, unknown>;
  }>,
  outSkillsDir: string,
): void {
  for (const skill of skills) {
    const destDir = join(outSkillsDir, skill.name);
    copyDir(skill.dir, destDir);
    const skillMdPath = join(destDir, "SKILL.md");
    if (existsSync(skillMdPath)) {
      let content = toPlatformSkillMarkdown(readFile(skillMdPath));
      if (skill.extraFrontmatter && Object.keys(skill.extraFrontmatter).length > 0) {
        content = applySkillFrontmatterOverrides(content, skill.extraFrontmatter);
      }
      writeFile(skillMdPath, content + "\n");
    }
  }
}
