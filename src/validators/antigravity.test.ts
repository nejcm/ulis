import { describe, expect, it } from "bun:test";

import { AgentFrontmatterSchema, RuleFrontmatterSchema } from "../schema.js";
import { validateAntigravityAgentTools, validateAntigravityRuleSize } from "./antigravity.js";

function agent(name: string, frontmatter: Record<string, unknown>) {
  return { name, frontmatter: AgentFrontmatterSchema.parse({ description: "d", ...frontmatter }), body: "" };
}

function rule(name: string, body: string, frontmatter: Record<string, unknown> = {}) {
  return { name, filename: `${name}.md`, frontmatter: RuleFrontmatterSchema.parse(frontmatter), body };
}

describe("validateAntigravityAgentTools", () => {
  it("warns when capabilities are dropped and when nothing maps", () => {
    const diags = validateAntigravityAgentTools([
      agent("writer", { tools: { read: true, write: true, browser: true } }),
      agent("allowlist", { tools: "view_file, Bash" }),
    ]);
    expect(diags.map((d) => d.message)).toEqual([
      "Antigravity has no documented tool for write, browser; omitted from tools",
      "ULIS cannot map a string tools allowlist (view_file, Bash) to Antigravity; omitted from tools, so the subagent gets no tools",
    ]);
    expect(diags).toMatchObject([
      { entity: "agent:writer", fieldPath: "tools", target: "antigravity" },
      { entity: "agent:allowlist" },
    ]);
  });

  it("skips mappable tools, native tools and disabled agents", () => {
    expect(
      validateAntigravityAgentTools([
        agent("reader", { tools: { read: true, edit: true, bash: true } }),
        agent("native", { tools: { write: true }, platforms: { antigravity: { tools: ["view_file"] } } }),
        agent("off", { tools: { write: true }, platforms: { antigravity: { enabled: false } } }),
      ]),
    ).toEqual([]);
  });
});

describe("validateAntigravityRuleSize", () => {
  it("warns only for enabled rule files past 24,000 bytes", () => {
    const big = "x".repeat(24_000);
    const diags = validateAntigravityRuleSize([
      rule("big", big),
      rule("small", "x"),
      rule("off", big, { platforms: { antigravity: { enabled: false } } }),
    ]);
    expect(diags).toMatchObject([
      {
        level: "warning",
        entity: "rule:big",
        target: "antigravity",
        suggestion: expect.stringContaining("platforms.antigravity.enabled: false"),
      },
    ]);
  });
});
