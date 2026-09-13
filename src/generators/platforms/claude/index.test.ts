import { afterEach, describe, expect, it } from "bun:test";
import { join } from "node:path";

import { cleanupTempRoots, createTempRoot, readTextFile, writeTextFile } from "../../../test-utils/fs.js";
import type { ProjectBundle } from "../../types.js";
import { writeResult } from "../../writer.js";
import { generateClaude } from "./index.js";

afterEach(cleanupTempRoots);

const silentLogger = { info() {}, success() {}, warn() {}, error() {}, dim() {}, header() {} };

function createProject(sourceDir: string): ProjectBundle {
  return {
    agents: [],
    skills: [],
    rules: [],
    mcp: { servers: {} },
    permissions: undefined,
    ulisConfig: { version: 1, name: "test", unsupportedPlatformRules: "inject" },
    sourceDir,
  };
}

describe("generateClaude CLAUDE.md alias", () => {
  it("writes an @AGENTS.md import, not a markdown link", () => {
    const root = createTempRoot("ulis-claude-alias-");
    const sourceDir = join(root, "source");
    const outDir = join(root, "out");
    writeTextFile(join(sourceDir, "raw", "all", "AGENTS.md"), "Instructions.\n");

    writeResult(generateClaude(createProject(sourceDir)), outDir, "claude", silentLogger);

    // Claude Code only loads an alias written as `@AGENTS.md`; a markdown link is inert prose, so
    // this assertion is the difference between AGENTS.md reaching the model and reaching nothing.
    expect(readTextFile(join(outDir, "CLAUDE.md"))).toBe("@AGENTS.md\n");
  });

  it("declares the alias content on the generation result", () => {
    expect(generateClaude(createProject("/abs/source")).post.aliasContent).toBe("@AGENTS.md\n");
  });
});
