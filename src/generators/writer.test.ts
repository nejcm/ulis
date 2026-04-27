import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GenerationResult } from "./types.js";
import { writeResult } from "./writer.js";

const tmpRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-writer-"));
  tmpRoots.push(root);
  return root;
}

function resultWithArtifact(path: string): GenerationResult {
  return {
    artifacts: [{ path, contents: "content" }],
    post: { rawDirs: [], aliasFiles: [], skillDirs: [] },
  };
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("writeResult", () => {
  it("rejects artifact paths that escape the output directory", () => {
    const outDir = createTempRoot();
    expect(() => writeResult(resultWithArtifact("../escaped.txt"), outDir, "claude")).toThrow(
      "outside output directory",
    );
  });

  it("rejects absolute artifact paths", () => {
    const outDir = createTempRoot();
    expect(() => writeResult(resultWithArtifact("C:\\temp\\escaped.txt"), outDir, "claude")).toThrow(
      "absolute artifact path",
    );
  });
});
