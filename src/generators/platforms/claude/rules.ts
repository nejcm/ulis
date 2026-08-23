import { join } from "node:path";

import type { ParsedRule } from "../../../parsers/rule.js";
import { serializeYamlFrontmatter } from "../../shared/yaml.js";
import type { FileArtifact } from "../../types.js";

export function buildClaudeRuleArtifact(rule: ParsedRule): FileArtifact {
  const fm = rule.frontmatter;
  const frontmatter = {
    description: fm.description || undefined,
    paths: fm.paths?.length ? fm.paths : undefined,
    alwaysApply: fm.alwaysApply || undefined,
  };
  const hasFrontmatter = fm.description || fm.paths?.length || fm.alwaysApply;
  const contents = hasFrontmatter ? `${serializeYamlFrontmatter(frontmatter)}\n\n${rule.body}\n` : `${rule.body}\n`;
  return { path: join("rules", rule.filename), contents };
}
