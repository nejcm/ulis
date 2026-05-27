import { describe, expect, it } from "bun:test";
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
    const result = buildRulesIndex([createRule({ body: "rule content\n" })], {
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
    const result = buildRulesIndex([createRule({ body: "rule content\n" })], {
      artifactPrefix: "rules",
      referencePrefix: "~/.codex/rules",
      indexPath: "AGENTS.md",
    });

    expect(result).not.toBeNull();
    expect(result?.artifacts).toEqual([{ path: join("rules", "common/code-review.md"), contents: "rule content\n" }]);
    expect(result?.appendEntry.content).toContain("`~/.codex/rules/common/code-review.md`");
  });
});
