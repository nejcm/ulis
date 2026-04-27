import matter from "gray-matter";

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
  const parsed = matter(md);
  const merged = { ...parsed.data, ...extra };
  const body = parsed.content.trim();
  if (Object.keys(merged).length === 0) return body;
  return matter.stringify(body, merged).trim();
}

/**
 * Preserve non-ULIS frontmatter and strip ULIS-only control keys.
 */
export function toPlatformSkillMarkdown(rawSkillMd: string): string {
  const parsed = matter(rawSkillMd);
  const filteredFrontmatter = Object.fromEntries(
    Object.entries(parsed.data).filter(([key]) => !ULIS_SKILL_FRONTMATTER_KEYS.has(key)),
  );
  const body = parsed.content.trim();
  if (Object.keys(filteredFrontmatter).length === 0) {
    return body;
  }
  return matter.stringify(body, filteredFrontmatter).trim();
}
