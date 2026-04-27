import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadSkills, mergeSkillsConfigs } from "./skills.js";

describe("loadSkills", () => {
  it("returns empty config for empty skills.yaml", () => {
    const dir = mkdtempSync(join(tmpdir(), "ulis-skills-"));
    try {
      writeFileSync(join(dir, "skills.yaml"), "# intentionally empty\n");
      expect(loadSkills(dir)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("merges platform skill installs in order", () => {
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
});
