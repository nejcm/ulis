import { withOrigin } from "../diagnostics.js";
import { unmappedDevinTools } from "../generators/platforms/devin/agents.js";
import { enabledAgentsFor, type ParsedAgent } from "../parsers/agent.js";
import { enabledSkillsFor, type ParsedSkill } from "../parsers/skill.js";
import type { McpConfig } from "../schema.js";
import type { Diagnostic } from "../types.js";
import { mcpServersFor } from "../utils/mcp-block.js";

const DROPPED_SKILL_FIELDS = [
  ["model", "Devin expects a model its --model flag accepts"],
  ["allowed-tools", "Devin expects allowed-tools as a list"],
] as const;

/** Canonical skill fields the Devin writer drops unless `platforms.devin` sets the native value. */
export function validateDevinSkills(skills: readonly ParsedSkill[]): Diagnostic[] {
  return enabledSkillsFor(skills, "devin").flatMap((skill) =>
    DROPPED_SKILL_FIELDS.filter(
      ([field]) => skill.frontmatter?.[field] !== undefined && !skill.frontmatter.platforms?.devin?.[field],
    ).map(([field, reason]) => ({
      level: "warning" as const,
      entity: `skill:${skill.name}`,
      message: `${reason}; ${field} omitted from the Devin skill`,
      suggestion: `set platforms.devin.${field}`,
      ...withOrigin(skill.origin, { fieldPath: field, target: "devin" }),
    })),
  );
}

/** Devin requires `command` on a local server and `url` on a remote one; the generator omits either when missing. */
export function validateDevinMcpEndpoints(mcp: McpConfig): Diagnostic[] {
  return [...mcpServersFor(mcp, "devin")].flatMap(([name, server]) => {
    const field = server.type === "remote" ? "url" : "command";
    if (server[field]?.trim()) return [];
    return [
      {
        level: "warning" as const,
        entity: `mcp:${name}`,
        message: `${server.type} server has no ${field}; omitted from Devin mcp_config.json`,
        suggestion: `set ${field} or drop devin from targets`,
        fieldPath: `servers.${name}.${field}`,
        relativeFile: "mcp.yaml",
        target: "devin",
      },
    ];
  });
}

const BUILTIN_SUBAGENTS = ["subagent_explore", "subagent_general"];

/** Devin grants a subagent every tool when `allowed-tools` is omitted; the canonical model and mcpServers are dropped. */
export function validateDevinAgents(agents: readonly ParsedAgent[]): Diagnostic[] {
  return enabledAgentsFor(agents, "devin").flatMap((agent) => {
    const fm = agent.frontmatter;
    const native = fm.platforms?.devin;
    const unmapped = unmappedDevinTools(agent);
    const diags: Diagnostic[] = [];
    if (unmapped)
      diags.push({
        level: "warning",
        entity: `agent:${agent.name}`,
        message: `${unmapped.length ? `ULIS cannot map a string tools allowlist (${unmapped.join(", ")}) to Devin` : "tools grants nothing"}; allowed-tools omitted, so the Devin subagent gets every tool`,
        suggestion: "set platforms.devin.allowed-tools with native tool names",
        ...withOrigin(agent.origin, { fieldPath: "tools", target: "devin" }),
      });
    if (fm.model !== undefined && !native?.model)
      diags.push({
        level: "warning",
        entity: `agent:${agent.name}`,
        message: "Devin expects a model its --model flag accepts; model omitted from the Devin subagent",
        suggestion: "set platforms.devin.model",
        ...withOrigin(agent.origin, { fieldPath: "model", target: "devin" }),
      });
    const name = native?.name ?? agent.name;
    if (BUILTIN_SUBAGENTS.includes(String(name)))
      diags.push({
        level: "warning",
        entity: `agent:${agent.name}`,
        message: `Devin skips a custom subagent named after its built-in ${String(name)} profile`,
        suggestion: "rename the agent or platforms.devin.name",
        ...withOrigin(agent.origin, { fieldPath: "platforms.devin.name", target: "devin" }),
      });
    if (fm.mcpServers?.length)
      diags.push({
        level: "warning",
        entity: `agent:${agent.name}`,
        message: "Devin subagents take no mcpServers; references not emitted",
        suggestion: "servers in mcp.yaml still reach Devin through mcp_config.json",
        ...withOrigin(agent.origin, { fieldPath: "mcpServers[]", target: "devin" }),
      });
    return diags;
  });
}
