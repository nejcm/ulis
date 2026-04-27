import { join } from "node:path";

import type { ParsedRule } from "../../parsers/rule.js";
import { fileExists, readFile } from "../../utils/fs.js";
import type { FileArtifact } from "../types.js";

export interface RulesIndexOptions {
  /** Absolute path to the `.ulis/` source tree (to locate `rules/` on disk). */
  sourceDir: string;
  /**
   * Relative path prefix for rule artifact paths, e.g. `"rules"` or `".forge/rules"`.
   * Rule files are written as `<artifactPrefix>/<rule.filename>`.
   */
  artifactPrefix: string;
  /**
   * Relative path for the index injection file, e.g. `"AGENTS.md"` or `".forge/RULES.md"`.
   */
  indexPath: string;
}

/**
 * For platforms that don't support a native rules directory, this helper:
 * 1. Emits each enabled rule file as a `FileArtifact`.
 * 2. Returns an `appendAfterRaw` entry that injects a "## Rules" index into the
 *    platform's main instructions file after raw-dir merges complete.
 *
 * Returns `null` when `enabledRules` is empty (caller should skip the push).
 */
export function buildRulesIndex(
  enabledRules: readonly ParsedRule[],
  opts: RulesIndexOptions,
): { artifacts: readonly FileArtifact[]; appendEntry: { path: string; content: string } } | null {
  if (enabledRules.length === 0) return null;

  const artifacts: FileArtifact[] = [];

  for (const rule of enabledRules) {
    const src = join(opts.sourceDir, "rules", rule.filename);
    if (fileExists(src)) {
      artifacts.push({ path: join(opts.artifactPrefix, rule.filename), contents: readFile(src) });
    }
  }

  const indexLines = [
    "## Rules",
    "",
    "The following rules contain guidelines you should apply when relevant.",
    "Read the referenced file when working in the indicated context.",
    "",
  ];
  for (const rule of enabledRules) {
    let line = `- **${rule.name}** (\`rules/${rule.filename}\`)`;
    if (rule.frontmatter.description) line += `: ${rule.frontmatter.description}`;
    if (rule.frontmatter.paths?.length) {
      line += ` — apply when working in ${rule.frontmatter.paths.join(", ")}`;
    }
    indexLines.push(line);
  }

  return {
    artifacts,
    appendEntry: { path: opts.indexPath, content: indexLines.join("\n") + "\n" },
  };
}
