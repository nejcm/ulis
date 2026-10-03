import { parseFrontmatter, stringifyFrontmatter } from "./safe-matter.js";

export const ULIS_SKILL_FRONTMATTER_KEYS = new Set([
  "key",
  "argumentHint",
  "userInvocable",
  "allowModelInvocation",
  "allowImplicitInvocation",
  "effort",
  "isolation",
  "tools",
  "hooks",
  "paths",
  "platforms",
]);

/**
 * Merge platform-specific frontmatter overrides into an already-stripped SKILL.md.
 * Overwrites any existing keys with values from `extra`.
 */
export function applySkillFrontmatterOverrides(md: string, extra: Record<string, unknown>): string {
  if (Object.keys(extra).length === 0) return md;
  const parsed = parseFrontmatter(md);
  const merged = { ...parsed.data, ...extra };
  const body = parsed.content.trim();
  if (Object.keys(merged).length === 0) return body;
  return stringifyFrontmatter(body, merged).trim();
}

/** Strip ULIS control keys, preserve native frontmatter, then apply platform overrides. */
export function toPlatformSkillMarkdown(rawSkillMd: string, extra: Record<string, unknown> = {}): string {
  const parsed = parseFrontmatter(rawSkillMd);
  const filteredFrontmatter = Object.fromEntries(
    Object.entries(parsed.data).filter(([key]) => !ULIS_SKILL_FRONTMATTER_KEYS.has(key)),
  );
  const body = parsed.content.trim();
  const markdown =
    Object.keys(filteredFrontmatter).length === 0 ? body : stringifyFrontmatter(body, filteredFrontmatter).trim();
  return applySkillFrontmatterOverrides(markdown, extra);
}
