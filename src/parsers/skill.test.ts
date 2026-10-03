import { afterEach, describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";

import { cleanupTempRoots, createTempRoot, writeTextFile } from "../test-utils/fs.js";
import { parseSkills } from "./skill.js";

afterEach(cleanupTempRoots);

const fixturesDir = resolve(join(import.meta.dirname, "../../tests/fixtures/skills"));

describe("parseSkills", () => {
  it("parses the my-skill fixture correctly", () => {
    const skills = parseSkills(fixturesDir);
    expect(skills.length).toBe(1);

    const [skill] = skills;
    expect(skill.name).toBe("my-skill");
    expect(skill.frontmatter?.description).toBe("A minimal test skill");
    expect(skill.frontmatter?.name).toBe("my-skill");
    expect(skill.frontmatter?.userInvocable).toBe(true);
    expect(skill.body).toContain("Do the minimal test skill task");
  });

  it("returns empty array when directory doesn't exist", () => {
    const skills = parseSkills("/nonexistent/path");
    expect(skills).toEqual([]);
  });

  it("exposes the skill's directory path", () => {
    const [skill] = parseSkills(fixturesDir);
    expect(skill.dir).toContain("my-skill");
  });

  it("accepts shared objects from YAML merge keys and shared arrays", () => {
    const root = createTempRoot("ulis-skill-merge-");
    writeTextFile(
      join(root, "merged", "SKILL.md"),
      `---
name: merged
description: Merged skill
defaults: &d
  tools: {read: true}
  paths: &paths [src/**]
<<: *d
platforms:
  claude:
    paths: *paths
---
Body.
`,
    );
    const [skill] = parseSkills(root);
    expect(skill.frontmatter?.tools).toMatchObject({ read: true });
    expect(skill.frontmatter?.paths).toEqual(["src/**"]);
    expect(skill.frontmatter?.platforms?.claude?.paths).toEqual(["src/**"]);
  });

  it("rejects cyclic YAML aliases in skill frontmatter", () => {
    const root = createTempRoot("ulis-skill-yaml-");
    writeTextFile(
      join(root, "evil", "SKILL.md"),
      `---
name: evil
description: Evil skill
platforms:
  codex:
    loop: &loop
      self: *loop
---
Body.
`,
    );

    expect(() => parseSkills(root)).toThrow("platforms.codex.loop.self - Cyclic YAML aliases are not supported.");
  });

  // Acyclic, but each level aliases the previous twice: 2^30 nodes to walk if shared nodes are revisited.
  it("rejects a shared YAML alias chain quickly", () => {
    const root = createTempRoot("ulis-skill-yaml-");
    const chain = ["    a0: &a0 [x]"];
    for (let level = 1; level <= 30; level += 1)
      chain.push(`    a${level}: &a${level} [*a${level - 1}, *a${level - 1}]`);
    writeTextFile(
      join(root, "evil", "SKILL.md"),
      ["---", "name: evil", "description: Evil skill", "platforms:", "  codex:", ...chain, "---", "Body.", ""].join(
        "\n",
      ),
    );

    const started = performance.now();
    expect(() => parseSkills(root)).toThrow("YAML frontmatter cannot exceed 10000 node visits.");
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
