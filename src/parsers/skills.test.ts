import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { createTempRoot, writeTextFile } from "../test-utils/fs.js";
import { loadSkills, mergeSkillsConfigs } from "./skills.js";

describe("loadSkills", () => {
  it("returns empty config for empty skills.yaml", () => {
    const dir = createTempRoot("ulis-skills-");
    writeTextFile(join(dir, "skills.yaml"), "# intentionally empty\n");

    expect(loadSkills(dir)).toEqual({});
  });
});

describe("mergeSkillsConfigs", () => {
  it("merges distinct platform skill installs in order", () => {
    expect(
      mergeSkillsConfigs([
        {
          "*": {
            skills: [{ name: "preset/all" }],
          },
          cursor: {
            skills: [{ name: "preset/cursor" }],
          },
        },
        {
          "*": {
            skills: [{ name: "base/all" }],
          },
          cursor: {
            skills: [{ name: "base/cursor" }],
          },
        },
      ]),
    ).toEqual({
      "*": {
        skills: [{ name: "preset/all" }, { name: "base/all" }],
      },
      cursor: {
        skills: [{ name: "preset/cursor" }, { name: "base/cursor" }],
      },
    });
  });

  it("lets a base entry override a preset entry of the same name (base-wins, not additive)", () => {
    const merged = mergeSkillsConfigs([
      { "*": { skills: [{ name: "shared/skill", args: ["--preset-arg"] }] } },
      { "*": { skills: [{ name: "shared/skill", args: ["--base-arg"] }] } },
    ]);

    expect(merged["*"]?.skills).toEqual([{ name: "shared/skill", args: ["--base-arg"] }]);
  });

  it("keeps a preset entry that survives when the base declares a different name", () => {
    const merged = mergeSkillsConfigs([
      { "*": { skills: [{ name: "preset/only" }] } },
      { "*": { skills: [{ name: "base/only" }] } },
    ]);

    expect(merged["*"]?.skills).toEqual([{ name: "preset/only" }, { name: "base/only" }]);
  });

  it("lets key distinguish two entries that share a name", () => {
    const merged = mergeSkillsConfigs([
      {
        "*": {
          skills: [
            { name: "pkg/skills", key: "pkg/skills/a", args: ["--skill a"] },
            { name: "pkg/skills", key: "pkg/skills/b", args: ["--skill b"] },
          ],
        },
      },
    ]);

    expect(merged["*"]?.skills).toEqual([
      { name: "pkg/skills", key: "pkg/skills/a", args: ["--skill a"] },
      { name: "pkg/skills", key: "pkg/skills/b", args: ["--skill b"] },
    ]);
  });

  it("deduplicates repeated entries within a single layer, last occurrence winning, first position kept", () => {
    const merged = mergeSkillsConfigs([
      {
        "*": {
          skills: [
            { name: "dup/skill", args: ["--first"] },
            { name: "other/skill" },
            { name: "dup/skill", args: ["--second"] },
          ],
        },
      },
    ]);

    expect(merged["*"]?.skills).toEqual([{ name: "dup/skill", args: ["--second"] }, { name: "other/skill" }]);
  });

  it("three layers: a middle preset's entry wins when the top layer doesn't declare it", () => {
    const merged = mergeSkillsConfigs([
      { "*": { skills: [{ name: "shared", args: ["--a"] }] } },
      { "*": { skills: [{ name: "shared", args: ["--b"] }] } },
      { "*": { skills: [{ name: "other" }] } },
    ]);

    expect(merged["*"]?.skills).toEqual([{ name: "shared", args: ["--b"] }, { name: "other" }]);
  });

  it("preserves first-occurrence position across layers even when overridden later", () => {
    const merged = mergeSkillsConfigs([
      { "*": { skills: [{ name: "first" }, { name: "shared", args: ["--preset"] }] } },
      { "*": { skills: [{ name: "shared", args: ["--base"] }, { name: "last" }] } },
    ]);

    expect(merged["*"]?.skills).toEqual([{ name: "first" }, { name: "shared", args: ["--base"] }, { name: "last" }]);
  });

  it("merges the '*' platform key independently of a named platform key", () => {
    const merged = mergeSkillsConfigs([
      { "*": { skills: [{ name: "wildcard" }] }, claude: { skills: [{ name: "claude-only" }] } },
      { claude: { skills: [{ name: "claude-only", args: ["--override"] }] } },
    ]);

    expect(merged).toEqual({
      "*": { skills: [{ name: "wildcard" }] },
      claude: { skills: [{ name: "claude-only", args: ["--override"] }] },
    });
  });

  it("ignores empty entries while preserving populated ones", () => {
    expect(mergeSkillsConfigs([{ cursor: { skills: [] } }, { cursor: { skills: [{ name: "real" }] } }])).toEqual({
      cursor: { skills: [{ name: "real" }] },
    });
  });
});
