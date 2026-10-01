import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { previewInstalledExecution } from "../install/preview.js";
import { parseMarkdownFrontmatter } from "../parsers/_shared.js";
import { parseFrontmatter } from "./safe-matter.js";
import { applySkillFrontmatterOverrides, toPlatformSkillMarkdown } from "./skill-frontmatter.js";

const MARKER = "__ulisJsFrontmatterRan";
const marker = globalThis as Record<string, unknown>;

// Each spelling gray-matter's engine lookup resolves to its `eval`ing javascript engine.
const payloads = ["js", "javascript", "JavaScript", "Js "].map(
  (language) => `---${language}\n{ name: (globalThis.${MARKER} = "${language}") }\n---\nBody.\n`,
);

const roots: string[] = [];
afterEach(() => {
  delete marker[MARKER];
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("JavaScript frontmatter", () => {
  const entryPoints: Record<string, (raw: string) => unknown> = {
    parseFrontmatter,
    parseMarkdownFrontmatter,
    toPlatformSkillMarkdown,
    applySkillFrontmatterOverrides: (raw) => applySkillFrontmatterOverrides(raw, { extra: true }),
  };

  for (const [name, parse] of Object.entries(entryPoints)) {
    it(`is refused, never evaluated, by ${name}`, () => {
      for (const raw of payloads) {
        expect(() => parse(raw)).toThrow("JavaScript frontmatter");
        expect(marker[MARKER]).toBeUndefined();
      }
    });
  }

  it("is never evaluated by the trust preview reading a raw fragment", () => {
    const root = mkdtempSync(join(tmpdir(), "ulis-js-frontmatter-"));
    roots.push(root);
    const sourceDir = join(root, ".ulis");
    const write = (path: string, contents: string) => {
      mkdirSync(dirname(join(sourceDir, path)), { recursive: true });
      writeFileSync(join(sourceDir, path), contents);
    };
    write("config.yaml", "version: 1\nname: js\n");
    payloads.forEach((raw, index) => write(`raw/claude/agents/pwn${index}.md`, raw));

    previewInstalledExecution({ sourceDir, presets: [], platforms: ["claude"] });
    expect(marker[MARKER]).toBeUndefined();
  });
});
