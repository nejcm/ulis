import { AgentFrontmatterSchema, type AgentFrontmatter } from "../schema.js";
import { ParseError, readMarkdownDir } from "./_shared.js";

export interface ParsedAgent {
  name: string;
  frontmatter: AgentFrontmatter;
  body: string;
}

export type AgentPlatform = "claude" | "opencode" | "codex" | "cursor" | "forgecode";

/** Filter agents that are not explicitly disabled for the given platform. */
export function enabledAgentsFor(agents: readonly ParsedAgent[], platform: AgentPlatform): readonly ParsedAgent[] {
  return agents.filter((a) => a.frontmatter.platforms?.[platform]?.enabled !== false);
}

/**
 * Parse and validate all agent markdown files from the provided directory.
 */
export function parseAgents(agentsDir: string): readonly ParsedAgent[] {
  const { items, errors } = readMarkdownDir(agentsDir, AgentFrontmatterSchema, "agent", (name, frontmatter, body) => ({
    name,
    frontmatter,
    body,
  }));
  if (errors.length > 0) throw errors[0] as ParseError;
  return items;
}
