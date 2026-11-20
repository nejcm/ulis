import { withOrigin } from "../diagnostics.js";
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
