import { readdirSync } from "node:fs";
import { join, basename } from "node:path";

import matter from "gray-matter";

import { AgentFrontmatterSchema, type AgentFrontmatter } from "../schema.js";
import { readFile } from "../utils/fs.js";

export interface ParsedAgent {
  name: string;
  frontmatter: AgentFrontmatter;
  body: string;
}

export type AgentPlatform = "claude" | "opencode" | "codex" | "cursor";

/** Filter agents that are not explicitly disabled for the given platform. */
export function enabledAgentsFor(agents: readonly ParsedAgent[], platform: AgentPlatform): readonly ParsedAgent[] {
  return agents.filter((a) => a.frontmatter.platforms?.[platform]?.enabled !== false);
}

export function parseAgents(agentsDir: string): readonly ParsedAgent[] {
  const files = readdirSync(agentsDir).filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md");
  return files.map((file) => {
    const raw = readFile(join(agentsDir, file));
    const { data, content } = matter(raw);
    const frontmatter = AgentFrontmatterSchema.parse(data);
    return {
      name: basename(file, ".md"),
      frontmatter,
      body: content.trim(),
    };
  });
}
