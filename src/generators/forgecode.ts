import { join } from "node:path";

import { type ParsedAgent, enabledAgentsFor } from "../parsers/agent.js";
import { type ParsedRule, enabledRulesFor } from "../parsers/rule.js";
import { type ParsedSkill, enabledSkillsFor } from "../parsers/skill.js";
import type { McpConfig } from "../schema.js";
import { mergeOrCopyDir } from "../utils/config-merger.js";
import { cleanDir, copySkillDirs, fileExists, readFile, writeFile } from "../utils/fs.js";
import { log } from "../utils/logger.js";
import { mcpServersFor, translateEnvMap } from "../utils/mcp-block.js";
import { buildPolicyCommentBlock } from "../utils/policy-comments.js";
import { mapTools } from "../utils/tool-mapper.js";

const EFFORT_MAP: Record<string, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  max: "high",
};

export function generateForgecode(
  agents: readonly ParsedAgent[],
  skills: readonly ParsedSkill[],
  mcp: McpConfig,
  aiDir: string,
  outDir: string,
  rules: readonly ParsedRule[] = [],
  unsupportedPlatformRules: "inject" | "exclude" = "inject",
): void {
  cleanDir(outDir);
  log.header("ForgeCode");

  const enabledAgents = enabledAgentsFor(agents, "forgecode");
  for (const agent of enabledAgents) {
    const fm = agent.frontmatter;
    const forgePlatform = fm.platforms?.forgecode;
    const tools = mapTools(fm.tools, "forgecode");
    const model = forgePlatform?.model ?? fm.model;

    const lines: string[] = ["---"];
    lines.push(`id: ${agent.name}`);
    lines.push(`title: ${agent.name}`);
    lines.push(`description: ${fm.description}`);
    if (model) {
      lines.push(`model: ${model}`);
    }
    if (fm.temperature !== undefined) {
      lines.push(`temperature: ${fm.temperature}`);
    }
    if (fm.maxTurns !== undefined) {
      lines.push(`max_turns: ${fm.maxTurns}`);
    }
    if (tools.length > 0) {
      lines.push("tools:");
      for (const tool of tools) {
        lines.push(`  - ${tool}`);
      }
    }
    if (fm.effort) {
      lines.push("reasoning:");
      lines.push("  enabled: true");
      lines.push(`  effort: ${EFFORT_MAP[fm.effort] ?? "medium"}`);
    }
    lines.push("---");

    const policyBlock = buildPolicyCommentBlock(fm, "md");
    const bodyWithPolicy = policyBlock ? `${policyBlock}\n${agent.body.trim()}` : agent.body.trim();
    writeFile(join(outDir, ".forge", "agents", `${agent.name}.md`), `${lines.join("\n")}\n\n${bodyWithPolicy}\n`);
    log.dim(`  agent: ${agent.name}`);
  }
  if (enabledAgents.length > 0) {
    log.success(`.forge/agents (${enabledAgents.length} agents)`);
  }

  const enabledSkills = enabledSkillsFor(skills, "forgecode");
  copySkillDirs(enabledSkills, join(outDir, ".forge", "skills"));
  if (enabledSkills.length > 0) {
    log.success(`.forge/skills (${enabledSkills.length} skills)`);
  }

  const mcpServers: Record<string, Record<string, unknown>> = {};
  for (const [name, server] of mcpServersFor(mcp, "forgecode")) {
    if (server.type === "local") {
      const entry: Record<string, unknown> = {};
      if (server.command) entry.command = server.command;
      if (server.args) entry.args = server.args;
      const env = translateEnvMap(server.env, "forgecode");
      if (env) entry.env = env;
      if (server.enabled === false) {
        entry.disable = true;
      }
      mcpServers[name] = entry;
      log.dim(`  mcp: ${name} (local)`);
      continue;
    }

    if (!server.url) {
      log.warn(`  mcp: ${name} skipped (remote with no url)`);
      continue;
    }

    const transportType = server.transport ?? "http";
    const entry: Record<string, unknown> = {
      type: transportType,
      url: server.url,
    };
    const headers = translateEnvMap(server.headers, "forgecode");
    if (headers) entry.headers = headers;
    if (server.enabled === false) {
      entry.disable = true;
    }
    mcpServers[name] = entry;
    log.dim(`  mcp: ${name} (remote)`);
  }

  writeFile(join(outDir, ".forge", ".mcp.json"), JSON.stringify({ mcpServers }, null, 2));
  log.success(".forge/.mcp.json");

  // Merge raw files into output (common first, then platform-specific to allow overrides)
  const rawCommon = join(aiDir, "raw", "common");
  if (fileExists(rawCommon)) {
    mergeOrCopyDir(rawCommon, outDir);
    log.success("raw/common/");
  }
  const rawPlatform = join(aiDir, "raw", "forgecode");
  if (fileExists(rawPlatform)) {
    mergeOrCopyDir(rawPlatform, outDir);
    log.success("raw/forgecode/");
  }

  // Generate .forge/RULES.md after all raw merges (ForgeCode has no AGENTS.md equivalent)
  if (unsupportedPlatformRules === "inject") {
    const enabledRules = enabledRulesFor(rules, "forgecode");
    if (enabledRules.length > 0) {
      for (const rule of enabledRules) {
        const src = join(aiDir, "rules", rule.filename);
        if (fileExists(src)) {
          writeFile(join(outDir, ".forge", "rules", rule.filename), readFile(src));
        }
      }
      const indexLines = [
        "## Rules",
        "",
        "The following rules contain guidelines you should apply when relevant.",
        "Read the referenced file when working in the indicated context.",
        "",
      ];
      for (const rule of enabledRules) {
        let line = `- **${rule.name}** (\`rules/${rule.filename}\`)`;
        if (rule.frontmatter.description) line += `: ${rule.frontmatter.description}`;
        if (rule.frontmatter.paths?.length) {
          line += ` — apply when working in ${rule.frontmatter.paths.join(", ")}`;
        }
        indexLines.push(line);
      }
      writeFile(join(outDir, ".forge", "RULES.md"), indexLines.join("\n") + "\n");
      log.success(".forge/RULES.md (rules index)");
    }
  }
}
