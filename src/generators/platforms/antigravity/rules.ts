import { join } from "node:path";

import type { ParsedRule } from "../../../parsers/rule.js";
import { serializeYamlFrontmatter } from "../../shared/yaml.js";
import type { FileArtifact } from "../../types.js";

function ruleFrontmatter(rule: ParsedRule): Record<string, unknown> {
  const fm = rule.frontmatter;
  const description = fm.description || undefined;
  if (fm.alwaysApply) return { trigger: "always_on", description };
  if (fm.paths?.length) return { trigger: "glob", description, globs: fm.paths.join(",") };
  if (description) return { trigger: "model_decision", description };
  return { trigger: "always_on" };
}

/** Nested rule names flatten to one level, so `a/b.md` lands at `rules/a-b.md`. */
export function buildAntigravityRuleArtifact(rule: ParsedRule): FileArtifact {
  return {
    path: join("rules", `${rule.name.replaceAll("/", "-")}.md`),
    contents: `${serializeYamlFrontmatter(ruleFrontmatter(rule))}\n\n${rule.body}\n`,
  };
}
