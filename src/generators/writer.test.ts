import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("writeResult", () => {
  it("writes file artifacts under the output directory", () => {
    const outDir = createTempRoot();

    writeResult(resultWithArtifact(join("nested", "artifact.txt")), outDir, "claude");

    expect(read(join(outDir, "nested", "artifact.txt"))).toBe("content");
  });

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

  it("copies skill directories into the default skills destination", () => {
    const root = createTempRoot();
    const outDir = join(root, "out");
    const skillDir = join(root, "source-skill");
    write(
      join(skillDir, "SKILL.md"),
      ["---", "name: source-skill", "allowImplicitInvocation: true", "custom: keep", "---", "", "Skill body."].join(
        "\n",
      ),
    );

    writeResult(
      {
        artifacts: [],
        post: {
          rawDirs: [],
          aliasFiles: [],
          skillDirs: [{ name: "copied-skill", dir: skillDir, extraFrontmatter: { model: "gpt-test" } }],
        },
      },
      outDir,
      "cursor",
    );

    const copied = read(join(outDir, "skills", "copied-skill", "SKILL.md"));
    expect(copied).toContain("custom: keep");
    expect(copied).toContain("model: gpt-test");
    expect(copied).not.toContain("allowImplicitInvocation");
    expect(copied).toContain("Skill body.");
  });

  it("copies skill directories into a custom skills destination", () => {
    const root = createTempRoot();
    const outDir = join(root, "out");
    const skillDir = join(root, "source-skill");
    write(join(skillDir, "SKILL.md"), "Skill body.");

    writeResult(
      {
        artifacts: [],
        post: {
          rawDirs: [],
          aliasFiles: [],
          skillDirs: [{ name: "forge-skill", dir: skillDir }],
          skillsDestRelative: join(".forge", "skills"),
        },
      },
      outDir,
      "forgecode",
    );

    expect(read(join(outDir, ".forge", "skills", "forge-skill", "SKILL.md"))).toBe("Skill body.\n");
  });

  it("copies existing copyDirs and skips missing ones", () => {
    const root = createTempRoot();
    const outDir = join(root, "out");
    const docsDir = join(root, "docs");
    write(join(docsDir, "guide.md"), "Guide");

    writeResult(
      {
        artifacts: [],
        post: {
          rawDirs: [],
          aliasFiles: [],
          skillDirs: [],
          copyDirs: [
            { src: docsDir, destRelative: "docs" },
            { src: join(root, "missing"), destRelative: "missing" },
          ],
        },
      },
      outDir,
      "opencode",
    );

    expect(read(join(outDir, "docs", "guide.md"))).toBe("Guide");
    expect(existsSync(join(outDir, "missing"))).toBe(false);
  });

  it("merges raw directories after artifacts", () => {
    const root = createTempRoot();
    const outDir = join(root, "out");
    const rawDir = join(root, "raw");
    write(join(rawDir, "config.json"), JSON.stringify({ raw: true }));

    writeResult(
      {
        artifacts: [{ path: "config.json", contents: JSON.stringify({ generated: true }) }],
        post: { rawDirs: [rawDir], aliasFiles: [], skillDirs: [] },
      },
      outDir,
      "claude",
    );

    expect(JSON.parse(read(join(outDir, "config.json")))).toEqual({ generated: true, raw: true });
  });

  it("appends after raw merges and then writes aliases", () => {
    const root = createTempRoot();
    const outDir = join(root, "out");
    const rawDir = join(root, "raw");
    write(join(rawDir, "AGENTS.md"), "Raw instructions.\n");

    writeResult(
      {
        artifacts: [],
        post: {
          rawDirs: [rawDir],
          aliasFiles: ["CLAUDE.md"],
          skillDirs: [],
          appendAfterRaw: [{ path: "AGENTS.md", content: "## Rules\n\nRead rules.\n" }],
        },
      },
      outDir,
      "claude",
    );

    expect(read(join(outDir, "AGENTS.md"))).toBe("Raw instructions.\n\n## Rules\n\nRead rules.\n");
    expect(read(join(outDir, "CLAUDE.md"))).toBe("See [AGENTS.md](./AGENTS.md) for instructions.\n");
  });

  it("creates appendAfterRaw files before alias creation", () => {
    const outDir = createTempRoot();

    writeResult(
      {
        artifacts: [],
        post: {
          rawDirs: [],
          aliasFiles: ["CLAUDE.md"],
          skillDirs: [],
          appendAfterRaw: [{ path: "AGENTS.md", content: "Generated instructions.\n" }],
        },
      },
      outDir,
      "claude",
    );

    expect(read(join(outDir, "AGENTS.md"))).toBe("Generated instructions.\n");
    expect(read(join(outDir, "CLAUDE.md"))).toBe("See [AGENTS.md](./AGENTS.md) for instructions.\n");
  });
});
