import { describe, it, expect } from "bun:test";

import type { ParsedAgent } from "../parsers/agent.js";
import type { ParsedSkill } from "../parsers/skill.js";
import type { AgentFrontmatter, McpConfig } from "../schema.js";
import { validateCrossRefs } from "./cross-refs.js";

function makeAgent(name: string, fm: Partial<AgentFrontmatter> = {}): ParsedAgent {
  return {
    name,
    body: "",
    frontmatter: {
      description: "test",
      model: "sonnet",
      tools: { read: true, write: false, edit: false, bash: false, search: false, browser: false },
      tags: [],
      ...fm,
    } as AgentFrontmatter,
  };
}

function makeSkill(name: string): ParsedSkill {
  return {
    name,
    dir: `/fake/${name}`,
    body: "",
    frontmatter: {
      description: "test",
      userInvocable: true,
      allowModelInvocation: true,
      allowImplicitInvocation: true,
      tags: [],
    } as ParsedSkill["frontmatter"],
  };
}

const emptyMcp: McpConfig = { servers: {} };

describe("validateCrossRefs", () => {
  it("returns no diagnostics for an empty bundle", () => {
    expect(validateCrossRefs([], [], emptyMcp)).toEqual([]);
  });

  it("returns no diagnostics when every reference resolves", () => {
    const agents = [makeAgent("alpha", { skills: ["my-skill"], mcpServers: ["server-a"] }), makeAgent("beta")];
    const skills = [makeSkill("my-skill")];
    const mcp: McpConfig = {
      servers: { "server-a": { type: "local", targets: ["claude"] } },
    };
    expect(validateCrossRefs(agents, skills, mcp)).toEqual([]);
  });

  it("warns on missing skill reference", () => {
    const agents = [makeAgent("alpha", { skills: ["does-not-exist"] })];
    const diags = validateCrossRefs(agents, [], emptyMcp);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.level).toBe("warning");
    expect(diags[0]?.entity).toBe("agent:alpha");
    expect(diags[0]?.message).toContain("does-not-exist");
  });

  it("errors on missing mcp reference", () => {
    const agents = [makeAgent("alpha", { mcpServers: ["ghost"] })];
    const diags = validateCrossRefs(agents, [], emptyMcp);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.level).toBe("error");
    expect(diags[0]?.message).toContain("ghost");
  });

  it("warns on unknown subagent in allowlist", () => {
    const agents = [
      makeAgent("alpha", {
        tools: {
          read: true,
          write: false,
          edit: false,
          bash: false,
          search: false,
          browser: false,
          agent: ["nope"],
        },
      }),
    ];
    const diags = validateCrossRefs(agents, [], emptyMcp);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.level).toBe("warning");
    expect(diags[0]?.message).toContain("nope");
  });

  it("ignores subagent allowlist when tools.agent is true (not array)", () => {
    const agents = [
      makeAgent("alpha", {
        tools: {
          read: true,
          write: false,
          edit: false,
          bash: false,
          search: false,
          browser: false,
          agent: true,
        },
      }),
    ];
    expect(validateCrossRefs(agents, [], emptyMcp)).toEqual([]);
  });
});
