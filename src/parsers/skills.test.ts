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
