import { RuleFrontmatterSchema, type RuleFrontmatter } from "../schema.js";
import { ParseError, readMarkdownDir } from "./_shared.js";

export interface ParsedRule {
  /** Stem of the file relative to the rules dir, normalized to forward slashes. E.g. "code-style" or "backend/api". */
  name: string;
  /** Relative path including extension. E.g. "code-style.md" or "backend/api.md". */
  filename: string;
  frontmatter: RuleFrontmatter;
  body: string;
}

export type RulePlatform = "claude" | "opencode" | "codex" | "cursor" | "forgecode";

/** Filter rules not explicitly disabled for the given platform. */
export function enabledRulesFor(rules: readonly ParsedRule[], platform: RulePlatform): readonly ParsedRule[] {
  return rules.filter((r) => r.frontmatter.platforms?.[platform]?.enabled !== false);
}

/**
 * Parse and validate markdown rule files, including nested rule paths.
 */
export function parseRules(rulesDir: string): readonly ParsedRule[] {
  const { items, errors } = readMarkdownDir(
    rulesDir,
    RuleFrontmatterSchema,
    "rule",
    (name, frontmatter, body, relFile) => ({ name, filename: relFile, frontmatter, body }),
    { recursive: true },
  );
  if (errors.length > 0) throw errors[0] as ParseError;
  return items;
}
