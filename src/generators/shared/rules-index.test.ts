import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ParsedRule } from "../../parsers/rule.js";
import { buildRulesIndex } from "./rules-index.js";

function createRule(overrides: Partial<ParsedRule> = {}): ParsedRule {
  return {
    name: "code-review",
    filename: "common/code-review.md",
    frontmatter: {
      alwaysApply: false,
    },
    body: "Rule body",
    ...overrides,
  };
}

describe("buildRulesIndex", () => {
  it("references the emitted artifact path in the AGENTS.md index", () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "ulis-rules-index-"));
    const rulePath = join(sourceDir, "rules", "common", "code-review.md");
    mkdirSync(join(sourceDir, "rules", "common"), { recursive: true });
    writeFileSync(rulePath, "rule content\n");

    const result = buildRulesIndex([createRule()], {
      sourceDir,
      artifactPrefix: join(".forge", "rules"),
      indexPath: "AGENTS.md",
    });

    expect(result).not.toBeNull();
    expect(result?.artifacts).toEqual([
      { path: join(".forge", "rules", "common/code-review.md"), contents: "rule content\n" },
    ]);
    expect(result?.appendEntry.content).toContain("`.forge/rules/common/code-review.md`");
  });

  it("supports a distinct home-anchored reference prefix for AGENTS.md links", () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "ulis-rules-index-"));
    const rulePath = join(sourceDir, "rules", "common", "code-review.md");
    mkdirSync(join(sourceDir, "rules", "common"), { recursive: true });
    writeFileSync(rulePath, "rule content\n");

    const result = buildRulesIndex([createRule()], {
      sourceDir,
      artifactPrefix: "rules",
      referencePrefix: "~/.codex/rules",
      indexPath: "AGENTS.md",
    });

    expect(result).not.toBeNull();
    expect(result?.artifacts).toEqual([{ path: "rules/common/code-review.md", contents: "rule content\n" }]);
    expect(result?.appendEntry.content).toContain("`~/.codex/rules/common/code-review.md`");
  });
});
