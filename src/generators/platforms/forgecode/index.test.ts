import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ParsedRule } from "../../../parsers/rule.js";
import { cleanupTempRoots, createTempRoot } from "../../../test-utils/fs.js";
import type { ProjectBundle } from "../../types.js";
import { generateForgecode } from "./index.js";

afterEach(cleanupTempRoots);

function createProject(sourceDir: string, rules: readonly ParsedRule[]): ProjectBundle {
  return {
    agents: [],
    skills: [],
    rules,
    mcp: { servers: {} },
    permissions: undefined,
    ulisConfig: { version: 1, name: "test", unsupportedPlatformRules: "inject" },
    sourceDir,
  };
}

describe("generateForgecode", () => {
  it("folds rule references into root AGENTS.md", () => {
    const sourceDir = createTempRoot("ulis-forgecode-");
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
