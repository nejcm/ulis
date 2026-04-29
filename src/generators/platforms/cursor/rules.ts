import { join } from "node:path";

import type { ParsedRule } from "../../../parsers/rule.js";
import type { FileArtifact } from "../../types.js";

export function buildCursorRuleArtifact(rule: ParsedRule): FileArtifact {
  const fm = rule.frontmatter;
  const fmLines: string[] = ["---"];
  if (fm.description) fmLines.push(`description: ${fm.description}`);
  if (fm.paths?.length) {
    fmLines.push("globs:");
    for (const p of fm.paths) fmLines.push(`  - "${p}"`);
  }
  if (fm.alwaysApply) fmLines.push("alwaysApply: true");
  fmLines.push("---");
  const hasFrontmatter = fm.description || fm.paths?.length || fm.alwaysApply;
  const mdcFilename = rule.filename.replace(/\.md$/, ".mdc");
  const contents = hasFrontmatter ? `${fmLines.join("\n")}\n\n${rule.body}\n` : `${rule.body}\n`;
  return { path: join("rules", mdcFilename), contents };
}
