import { withOrigin } from "../diagnostics.js";
import { unmappedTools } from "../generators/platforms/antigravity/agents.js";
import { buildAntigravityRuleArtifact } from "../generators/platforms/antigravity/rules.js";
import { enabledAgentsFor, type ParsedAgent } from "../parsers/agent.js";
import { enabledRulesFor, type ParsedRule } from "../parsers/rule.js";
import type { Diagnostic } from "../types.js";
import { mapTools } from "../utils/tool-mapper.js";

const RULE_TRUNCATION_BYTES = 24_000;

/** Antigravity grants a subagent only the listed tools, so a dropped capability is lost at runtime. */
export function validateAntigravityAgentTools(agents: readonly ParsedAgent[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const agent of enabledAgentsFor(agents, "antigravity")) {
    if (agent.frontmatter.platforms?.antigravity?.tools) continue;
    const dropped = unmappedTools(agent.frontmatter.tools);
    if (dropped.length === 0) continue;
    const tools = agent.frontmatter.tools;
    const noTools = mapTools(tools, "antigravity").length === 0;
    const reason =
      typeof tools === "string"
        ? `ULIS cannot map a string tools allowlist (${dropped.join(", ")}) to Antigravity`
        : `Antigravity has no documented tool for ${dropped.join(", ")}`;
    diags.push({
      level: "warning",
      entity: `agent:${agent.name}`,
      message: `${reason}; omitted from tools${noTools ? ", so the subagent gets no tools" : ""}`,
      suggestion: "set platforms.antigravity.tools with native tool names",
      ...withOrigin(agent.origin, { fieldPath: "tools", target: "antigravity" }),
    });
  }
  return diags;
}

/** Antigravity truncates a rule file past 24,000 bytes. */
export function validateAntigravityRuleSize(rules: readonly ParsedRule[]): Diagnostic[] {
  return enabledRulesFor(rules, "antigravity")
    .map((rule) => ({ rule, bytes: Buffer.byteLength(buildAntigravityRuleArtifact(rule).contents) }))
    .filter(({ bytes }) => bytes > RULE_TRUNCATION_BYTES)
    .map(({ rule, bytes }) => ({
      level: "warning",
      entity: `rule:${rule.name}`,
      message: `Antigravity rule file is ${bytes} bytes; Antigravity truncates past ${RULE_TRUNCATION_BYTES}`,
      suggestion: "split the rule or set platforms.antigravity.enabled: false",
      ...withOrigin(rule.origin, { target: "antigravity" }),
    }));
}
