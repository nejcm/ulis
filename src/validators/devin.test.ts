import { describe, expect, it } from "bun:test";

import type { ParsedSkill } from "../parsers/skill.js";
import { SkillFrontmatterSchema } from "../schema.js";
import { validateDevinMcpEndpoints, validateDevinSkills } from "./devin.js";

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
