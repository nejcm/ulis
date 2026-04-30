import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ParsedRule } from "../../../parsers/rule.js";
import type { ProjectBundle } from "../../types.js";
import { generateForgecode } from "./index.js";

function createProject(sourceDir: string, rules: readonly ParsedRule[]): ProjectBundle {
  return {
    agents: [],
    skills: [],
    rules,
    mcp: { servers: {} },
    permissions: undefined,
    plugins: undefined,
    ulisConfig: { version: 1, name: "test", unsupportedPlatformRules: "inject" },
    sourceDir,
  };
}

describe("generateForgecode", () => {
  it("folds rule references into root AGENTS.md", () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "ulis-forgecode-"));
    mkdirSync(join(sourceDir, "rules", "common"), { recursive: true });
    writeFileSync(join(sourceDir, "rules", "common", "security.md"), "Rule body\n");

    const result = generateForgecode(
      createProject(sourceDir, [
        {
          name: "security",
          filename: "common/security.md",
          frontmatter: { alwaysApply: false },
          body: "Rule body",
        },
      ]),
    );

    expect(result.artifacts).toContainEqual({
      path: join(".forge", "rules", "common/security.md"),
      contents: "Rule body\n",
    });
    expect(result.post.appendAfterRaw).toEqual([
      {
        path: "AGENTS.md",
        content: expect.stringContaining("`~/.forge/rules/common/security.md`"),
      },
    ]);
  });
});
