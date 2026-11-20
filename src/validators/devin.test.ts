import { describe, expect, it } from "bun:test";

import type { ParsedAgent } from "../parsers/agent.js";
import type { ParsedSkill } from "../parsers/skill.js";
import { AgentFrontmatterSchema, SkillFrontmatterSchema } from "../schema.js";
import { validateDevinAgents, validateDevinMcpEndpoints, validateDevinSkills } from "./devin.js";

function skill(name: string, frontmatter: Record<string, unknown>): ParsedSkill {
  return {
    name,
    dir: `/skills/${name}`,
    body: "",
    frontmatter: SkillFrontmatterSchema.parse({ name, description: "d", ...frontmatter }),
  } as ParsedSkill;
}

describe("validateDevinSkills", () => {
  it("warns when model or string allowed-tools is dropped without a native override", () => {
    const diags = validateDevinSkills([
      skill("both", { model: "claude-haiku-4-5", "allowed-tools": "Read Grep" }),
      skill("overridden", {
        model: "x",
        "allowed-tools": "Read",
        platforms: { devin: { model: "swe", "allowed-tools": ["read"] } },
      }),
      skill("off", { model: "x", platforms: { devin: { enabled: false } } }),
      skill("plain", {}),
    ]);
    expect(diags).toMatchObject([
      { entity: "skill:both", fieldPath: "model", target: "devin", suggestion: "set platforms.devin.model" },
      { entity: "skill:both", fieldPath: "allowed-tools", suggestion: "set platforms.devin.allowed-tools" },
    ]);
  });
});

describe("validateDevinMcpEndpoints", () => {
  it("warns for a Devin-bound local server without a command or remote server without a url", () => {
    const diags = validateDevinMcpEndpoints({
      servers: {
        noCommand: { type: "local" },
        noUrl: { type: "remote" },
        blankUrl: { type: "remote", url: " " },
        elsewhere: { type: "local", targets: ["claude"] },
        ok: { type: "local", command: "a" },
      },
    });
    expect(diags).toMatchObject([
      { entity: "mcp:noCommand", fieldPath: "servers.noCommand.command", target: "devin" },
      { entity: "mcp:noUrl", message: "remote server has no url; omitted from Devin mcp_config.json" },
      { entity: "mcp:blankUrl", fieldPath: "servers.blankUrl.url" },
    ]);
  });
});

describe("validateDevinAgents", () => {
  const agent = (name: string, frontmatter: Record<string, unknown>) =>
    ({
      name,
      body: "",
      frontmatter: AgentFrontmatterSchema.parse({ description: "d", ...frontmatter }),
    }) as ParsedAgent;

  it("warns when allowed-tools is omitted for an all-false or unmappable list, or the model is dropped", () => {
    const diags = validateDevinAgents([
      agent("none", { tools: { read: false } }),
      agent("claude-names", { tools: "Read, Bash", model: "opus" }),
      agent("overridden", {
        tools: "Read",
        model: "opus",
        platforms: { devin: { "allowed-tools": ["read"], model: "sonnet" } },
      }),
      agent("alias", { tools: "Read", platforms: { devin: { tools: ["read"] } } }),
      agent("off", { tools: { read: false }, model: "opus", platforms: { devin: { enabled: false } } }),
      agent("mapped", { tools: { bash: true } }),
    ]);
    expect(diags).toMatchObject([
      {
        entity: "agent:none",
        fieldPath: "tools",
        target: "devin",
        message: "tools grants nothing; allowed-tools omitted, so the Devin subagent gets every tool",
        suggestion: "set platforms.devin.allowed-tools with native tool names",
      },
      {
        entity: "agent:claude-names",
        fieldPath: "tools",
        message: expect.stringContaining("string tools allowlist (Read, Bash)"),
      },
      { entity: "agent:claude-names", fieldPath: "model", suggestion: "set platforms.devin.model" },
    ]);
    expect(diags).toHaveLength(3);
  });

  it("warns when platforms.devin.name shadows a built-in profile", () => {
    expect(
      validateDevinAgents([
        agent("explore", { tools: { bash: true }, platforms: { devin: { name: "subagent_explore" } } }),
      ]),
    ).toMatchObject([{ entity: "agent:explore", fieldPath: "platforms.devin.name", target: "devin" }]);
  });

  it("warns when canonical mcpServers are dropped", () => {
    expect(validateDevinAgents([agent("mcp", { tools: { bash: true }, mcpServers: ["github"] })])).toMatchObject([
      { entity: "agent:mcp", fieldPath: "mcpServers[]", target: "devin" },
    ]);
  });
});
