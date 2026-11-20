import { join } from "node:path";

import type { ParsedRule } from "../../parsers/rule.js";
import type { FileArtifact } from "../types.js";
import { serializeYamlFrontmatter } from "./yaml.js";

export type GlobsFormat = "string" | "list";

function ruleFrontmatter(rule: ParsedRule, globsFormat: GlobsFormat): Record<string, unknown> {
  const fm = rule.frontmatter;
  const description = fm.description || undefined;
  if (fm.alwaysApply) return { trigger: "always_on", description };
  if (fm.paths?.length)
    return { trigger: "glob", description, globs: globsFormat === "list" ? fm.paths : fm.paths.join(", ") };
  if (description) return { trigger: "model_decision", description };
  return { trigger: "always_on" };
}

/** A Windsurf-style `trigger` rule; nested names flatten to one level, so `a/b.md` lands at `rules/a-b.md`. */
export function buildTriggerRuleArtifact(rule: ParsedRule, globsFormat: GlobsFormat = "string"): FileArtifact {
  return {
    path: join("rules", `${rule.name.replaceAll("/", "-")}.md`),
    contents: `${serializeYamlFrontmatter(ruleFrontmatter(rule, globsFormat))}\n\n${rule.body}\n`,
  };
}

/** Every rule as a trigger rule, throwing when two flatten to one path. */
export function buildTriggerRuleArtifacts(
  rules: readonly ParsedRule[],
  label: string,
  globsFormat: GlobsFormat = "string",
): FileArtifact[] {
  const ruleSources = new Map<string, string>();
  return rules.map((rule) => {
    const artifact = buildTriggerRuleArtifact(rule, globsFormat);
    const clash = ruleSources.get(artifact.path);
    if (clash) throw new Error(`Rules "${clash}" and "${rule.name}" both flatten to ${artifact.path} for ${label}`);
    ruleSources.set(artifact.path, rule.name);
    return artifact;
  });
}
