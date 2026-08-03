import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { rawDirs } from "./source-dirs.js";
import type { ProjectBundle } from "./types.js";

describe("rawDirs", () => {
  it("uses raw/all before each platform-specific raw directory", () => {
    const project = { sourceDir: "source" } as ProjectBundle;

    for (const platform of ["claude", "codex", "cursor", "opencode", "forgecode"]) {
      expect(rawDirs(project, platform)).toEqual([join("source", "raw", "all"), join("source", "raw", platform)]);
    }
  });

  it("does not include the legacy raw/common directory", () => {
    const project = { sourceDir: "source" } as ProjectBundle;

    expect(rawDirs(project, "codex")).not.toContain(join("source", "raw", "common"));
  });
});
