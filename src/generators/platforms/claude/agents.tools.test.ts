import { describe, expect, it } from "bun:test";

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
    expect(out).toContain(
      'disallowedTools: "Read, Glob, Grep, Write, Edit, Bash, WebSearch, WebFetch, mcp__playwright__navigate, mcp__playwright__screenshot, Agent, mcp__*"',
    );
  });

  it("emits an allowlist and no deny-all when any tool is granted", () => {
    const out = render({ tools: { read: true } });
    expect(out).toContain('tools: "Read, Glob, Grep"');
    expect(out).not.toContain("disallowedTools");
  });
});
