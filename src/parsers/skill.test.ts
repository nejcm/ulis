import { describe, it, expect } from "bun:test";
import { join, resolve } from "node:path";

import { parseSkills } from "./skill.js";

const fixturesDir = resolve(join(import.meta.dirname, "../../tests/fixtures/skills"));

describe("parseSkills", () => {
  it("parses the my-skill fixture correctly", () => {
    const skills = parseSkills(fixturesDir);
    expect(skills.length).toBe(1);

    const [skill] = skills;
    expect(skill.name).toBe("my-skill");
    expect(skill.frontmatter.description).toBe("A minimal test skill");
    expect(skill.frontmatter.name).toBe("my-skill");
    expect(skill.frontmatter.userInvocable).toBe(true);
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
});
