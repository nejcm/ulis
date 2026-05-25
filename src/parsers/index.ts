import { join } from "node:path";

import type { McpConfig, PermissionsConfig, UlisConfig } from "../schema.js";
import { AgentFrontmatterSchema, RuleFrontmatterSchema, UlisConfigSchema } from "../schema.js";
import { loadValidatedConfigFile } from "../utils/config-loader.js";
import { ParseAggregateError, ParseError, readMarkdownDir } from "./_shared.js";
import { resolveAgentName, type ParsedAgent } from "./agent.js";
import { loadMcp } from "./mcp.js";
import { loadPermissions } from "./permissions.js";
import type { ParsedRule } from "./rule.js";
import type { ParsedSkill } from "./skill.js";
import { collectSkills } from "./skill.js";

// Re-export individual parsers and types for callers that need them directly
export { ParseAggregateError, ParseError } from "./_shared.js";
export { enabledAgentsFor, parseAgents } from "./agent.js";
export type { AgentPlatform, ParsedAgent } from "./agent.js";
export { parseCommands } from "./command.js";
export type { ParsedCommand } from "./command.js";
export { enabledRulesFor, parseRules } from "./rule.js";
export type { ParsedRule, RulePlatform } from "./rule.js";
export { enabledSkillsFor, parseSkills } from "./skill.js";
export type { ParsedSkill, SkillPlatform } from "./skill.js";

export interface ParsedProject {
  readonly agents: readonly ParsedAgent[];
  readonly skills: readonly ParsedSkill[];
  readonly rules: readonly ParsedRule[];
  readonly mcp: McpConfig;
  readonly permissions: PermissionsConfig | undefined;
  readonly ulisConfig: UlisConfig;
  readonly sourceDir: string;
}

export interface ParseProjectOptions {
  readonly source?: string;
}

/**
 * Parse all entity kinds from a ulis source directory in one call.
 * Collects every per-file error across agents, skills, and rules before
 * throwing, so users see all broken files at once instead of one at a time.
 */
export function parseProject(sourceDir: string, options: ParseProjectOptions = {}): ParsedProject {
  const allErrors: ParseError[] = [];
  const source = options.source ?? "base";

  const agentsResult = readMarkdownDir(
    join(sourceDir, "agents"),
    AgentFrontmatterSchema,
    "agent",
    (fileName, frontmatter, body, _relFile, origin) => ({
      name: resolveAgentName(fileName, frontmatter),
      frontmatter,
      body,
      origin,
    }),
    { sourceDir, source, relativePrefix: "agents" },
  );
  allErrors.push(...agentsResult.errors);

  const skillsResult = collectSkills(join(sourceDir, "skills"), { sourceDir, source });
  allErrors.push(...skillsResult.errors);

  const rulesResult = readMarkdownDir(
    join(sourceDir, "rules"),
    RuleFrontmatterSchema,
    "rule",
    (name, frontmatter, body, relFile, origin) => ({ name, filename: relFile, frontmatter, body, origin }),
    { recursive: true, sourceDir, source, relativePrefix: "rules" },
  );
  allErrors.push(...rulesResult.errors);

  const ulisConfig = collectConfigError(
    allErrors,
    () =>
      loadValidatedConfigFile({
        dir: sourceDir,
        baseName: "config",
        schema: UlisConfigSchema,
        defaultValue: { version: 1, name: "ulis" },
        diagnostic: { source, sourceDir },
      }),
    { version: 1, name: "ulis" } as UlisConfig,
  );
  const mcp = collectConfigError(allErrors, () => loadMcp(sourceDir, { source, sourceDir }), { servers: {} });
  const permissions = collectConfigError(allErrors, () => loadPermissions(sourceDir, { source, sourceDir }), {});

  if (allErrors.length > 0) throw new ParseAggregateError(allErrors);

  return {
    agents: agentsResult.items,
    skills: skillsResult.items,
    rules: rulesResult.items,
    mcp,
    permissions,
    ulisConfig,
    sourceDir,
  };
}

function collectConfigError<T>(errors: ParseError[], load: () => T, fallback: T): T {
  try {
    return load();
  } catch (err) {
    if (err instanceof ParseError) {
      errors.push(err);
      return fallback;
    }
    throw err;
  }
}
