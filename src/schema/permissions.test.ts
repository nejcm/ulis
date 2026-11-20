import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { PermissionsConfigSchema } from "./permissions.js";

const repoRoot = join(import.meta.dirname, "../..");
const platforms = Object.keys(
  (z.toJSONSchema(PermissionsConfigSchema, { target: "draft-7", io: "input" }) as { properties: object }).properties,
);

function permissionsExampleKeys(markdown: string): string[] {
  const section = /^## Permissions\b[\s\S]*?(?=^## |(?![\s\S]))/m.exec(markdown)?.[0] ?? "";
  const blocks = [...section.matchAll(/^ *```ya?ml\r?\n([\s\S]*?)^ *```/gm)].map((match) => parseYaml(match[1]!) ?? {});
  return blocks.flatMap((block) => Object.keys(block));
}

describe("permissions.yaml examples", () => {
  it.each(["docs/guide/examples.md", "skills/ulis/references/source.md"])("%s shows every platform block", (file) => {
    const keys = permissionsExampleKeys(readFileSync(join(repoRoot, file), "utf8"));
    expect(platforms.filter((platform) => !keys.includes(platform))).toEqual([]);
  });

  it("reads a Permissions section that ends the file and ignores non-YAML fences", () => {
    expect(permissionsExampleKeys("## Permissions\n\n```text\ndevin:\n```\n\n```yaml\nclaude: {}\n```\n")).toEqual([
      "claude",
    ]);
  });
});
