import { AI_GLOBAL_SOURCES_DIR } from "../config.js";
import type { ParsedAgent } from "../parsers/agent.js";
import type { ParsedSkill } from "../parsers/skill.js";
import type { McpConfig } from "../schema.js";

/**
 * Common diagnostic shape returned by every validator. The orchestrator in
 * `src/index.ts` collects diagnostics from all validators, prints warnings,
 * and aborts the build with exit code 1 if any errors were emitted.
 */
export interface Diagnostic {
  readonly level: "error" | "warning";
  readonly entity: string;
  readonly message: string;
  readonly suggestion?: string;
}

/**
 * Validate cross-entity references in the parsed bundle.
 * Checks:
 *   - agent.skills[]   → must reference a parsed skill   (warning)
 *   - agent.mcpServers → must reference an mcp.json key  (error)
 *   - tools.agent: []  → must reference a parsed agent   (warning)
 */
export function validateCrossRefs(
  agents: readonly ParsedAgent[],
  skills: readonly ParsedSkill[],
  mcp: McpConfig,
): readonly Diagnostic[] {
  const diags: Diagnostic[] = [];

  const agentNames = new Set(agents.map((a) => a.name));
  const skillNames = new Set(skills.map((s) => s.name));
  const mcpServerNames = new Set(Object.keys(mcp.servers));

  for (const agent of agents) {
    // 1. Skill references (warning — skill may be platform-installed elsewhere)
    if (agent.frontmatter.skills) {
      for (const skillRef of agent.frontmatter.skills) {
        if (!skillNames.has(skillRef)) {
          diags.push({
            level: "warning",
            entity: `agent:${agent.name}`,
            message: `References skill "${skillRef}" which is not defined in .ai/${AI_GLOBAL_SOURCES_DIR}/skills/`,
            suggestion: `Create .ai/${AI_GLOBAL_SOURCES_DIR}/skills/${skillRef}/SKILL.md or remove the reference`,
          });
        }
      }
    }

    // 2. MCP server references (error — output config will be broken)
    if (agent.frontmatter.mcpServers) {
      for (const mcpRef of agent.frontmatter.mcpServers) {
        if (!mcpServerNames.has(mcpRef)) {
          diags.push({
            level: "error",
            entity: `agent:${agent.name}`,
            message: `References MCP server "${mcpRef}" which is not defined in .ai/${AI_GLOBAL_SOURCES_DIR}/mcp.json`,
            suggestion: `Add "${mcpRef}" to .ai/${AI_GLOBAL_SOURCES_DIR}/mcp.json or remove the reference`,
          });
        }
      }
    }

    // 3. Subagent allowlist (warning — Claude will silently ignore unknown names)
    const agentTool = agent.frontmatter.tools.agent;
    if (Array.isArray(agentTool)) {
      for (const subagentRef of agentTool) {
        if (!agentNames.has(subagentRef)) {
          diags.push({
            level: "warning",
            entity: `agent:${agent.name}`,
            message: `Subagent allowlist references "${subagentRef}" which is not defined in .ai/${AI_GLOBAL_SOURCES_DIR}/agents/`,
            suggestion: `Create .ai/${AI_GLOBAL_SOURCES_DIR}/agents/${subagentRef}.md or remove from allowlist`,
          });
        }
      }
    }
  }

  return diags;
}
