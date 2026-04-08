import { describe, it, expect } from "bun:test";

import type { ParsedAgent } from "../parsers/agent.js";
import type { ParsedSkill } from "../parsers/skill.js";
import type { AgentFrontmatter, SkillFrontmatter } from "../schema.js";
import { validateCollisions } from "./collisions.js";

function agent(name: string): ParsedAgent {
  return {
    name,
    body: "",
    frontmatter: {
      description: "",
      model: "sonnet",
      tools: { read: true, write: false, edit: false, bash: false, search: false, browser: false },
      tags: [],
    } as AgentFrontmatter,
  };
}

function skill(name: string, frontmatterName?: string): ParsedSkill {
  return {
    name,
    dir: `/fake/${name}`,
    body: "",
    frontmatter: {
      name: frontmatterName,
      description: "",
      userInvocable: true,
      allowModelInvocation: true,
      allowImplicitInvocation: true,
      tags: [],
    } as SkillFrontmatter,
  };
}

describe("validateCollisions", () => {
  it("returns no diagnostics for unique names", () => {
    const out = validateCollisions([agent("alpha"), agent("beta")], [skill("one"), skill("two")]);
    expect(out).toEqual([]);
  });

  it("flags duplicate agent names as errors", () => {
    const out = validateCollisions([agent("dup"), agent("dup")], []);
    expect(out).toHaveLength(1);
    expect(out[0]?.level).toBe("error");
    expect(out[0]?.entity).toBe("agent:dup");
  });

  it("flags duplicate skill directory names", () => {
    const out = validateCollisions([], [skill("dup"), skill("dup")]);
    expect(out).toHaveLength(1);
    expect(out[0]?.level).toBe("error");
    expect(out[0]?.entity).toBe("skill:dup");
  });

  it("uses skill frontmatter `name` over directory name when present", () => {
    const out = validateCollisions([], [skill("dir-a", "shared-name"), skill("dir-b", "shared-name")]);
    expect(out).toHaveLength(1);
    expect(out[0]?.entity).toBe("skill:shared-name");
  });

  it("collects multiple duplicates in one pass", () => {
    const out = validateCollisions([agent("a"), agent("a"), agent("b"), agent("b")], []);
    expect(out).toHaveLength(2);
    expect(out.map((d) => d.entity).sort()).toEqual(["agent:a", "agent:b"]);
  });
});
