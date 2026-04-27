import { join } from "node:path";

import type { McpConfig, PermissionsConfig, PluginsConfig, UlisConfig } from "../schema.js";
import { AgentFrontmatterSchema, RuleFrontmatterSchema, UlisConfigSchema } from "../schema.js";
import { loadConfigFile } from "../utils/config-loader.js";
import { ParseAggregateError, ParseError, readMarkdownDir } from "./_shared.js";
import type { ParsedAgent } from "./agent.js";
import { loadMcp } from "./mcp.js";
import { loadPermissions } from "./permissions.js";
import { loadPlugins } from "./plugins.js";
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
  readonly plugins: PluginsConfig | undefined;
  readonly ulisConfig: UlisConfig;
  readonly sourceDir: string;
}

/**
 * Parse all entity kinds from a ulis source directory in one call.
 * Collects every per-file error across agents, skills, and rules before
 * throwing, so users see all broken files at once instead of one at a time.
 */
export function parseProject(sourceDir: string): ParsedProject {
  const allErrors: ParseError[] = [];

  const agentsResult = readMarkdownDir(
    join(sourceDir, "agents"),
    AgentFrontmatterSchema,
    "agent",
    (name, frontmatter, body) => ({ name, frontmatter, body }),
  );
  allErrors.push(...agentsResult.errors);

  const skillsResult = collectSkills(join(sourceDir, "skills"));
  allErrors.push(...skillsResult.errors);

  const rulesResult = readMarkdownDir(
    join(sourceDir, "rules"),
    RuleFrontmatterSchema,
    "rule",
    (name, frontmatter, body, relFile) => ({ name, filename: relFile, frontmatter, body }),
    { recursive: true },
  );
  allErrors.push(...rulesResult.errors);

  if (allErrors.length > 0) throw new ParseAggregateError(allErrors);

  const rawConfig = loadConfigFile(sourceDir, "config");
  const ulisConfig = UlisConfigSchema.parse(rawConfig ?? UlisConfigSchema.parse({ version: 1, name: "ulis" }));

  return {
    agents: agentsResult.items,
    skills: skillsResult.items,
    rules: rulesResult.items,
    mcp: loadMcp(sourceDir),
    permissions: loadPermissions(sourceDir),
    plugins: loadPlugins(sourceDir),
    ulisConfig,
    sourceDir,
  };
}
