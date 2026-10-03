import { describe, expect, it } from "bun:test";

import { parse } from "yaml";

import { AgentFrontmatterSchema } from "../../../schema.js";
import { buildClaudeAgentArtifact } from "./agents.js";

function render(frontmatter: Record<string, unknown>): string {
  const fm = AgentFrontmatterSchema.parse({ description: "d", ...frontmatter });
  return String(buildClaudeAgentArtifact({ name: "a", frontmatter: fm, body: "Body" }).contents);
}

describe("buildClaudeAgentArtifact tools", () => {
  it("denies every mapped tool, Agent and MCP when the canonical tools object grants nothing", () => {
    const out = render({ tools: { read: false } });
    expect(out).not.toMatch(/^tools:/m);
    const denied = parse(out.split("---")[1]!).disallowedTools.split(", ");
    const inherited = [
      "PowerShell",
      "Monitor",
      "LSP",
      "NotebookEdit",
      "Skill",
      "ToolSearch",
      "TaskStop",
      "Artifact",
      "mcp__custom__unknown",
    ];
    expect(
      inherited.filter((tool) => !denied.includes(tool) && !(tool.startsWith("mcp__") && denied.includes("mcp__*"))),
    ).toEqual([]);
  });

  it("emits an allowlist and no deny-all when any tool is granted", () => {
    const out = render({ tools: { read: true } });
    expect(out).toContain('tools: "Read, Glob, Grep"');
    expect(out).not.toContain("disallowedTools");
  });
});

it("grants notebook editing through canonical edit", () => {
  expect(render({ tools: { edit: true } })).toContain("NotebookEdit");
});
