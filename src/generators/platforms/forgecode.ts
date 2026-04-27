import { join } from "node:path";

import { enabledAgentsFor } from "../../parsers/agent.js";
import { enabledRulesFor } from "../../parsers/rule.js";
import { enabledSkillsFor } from "../../parsers/skill.js";
import { mcpServersFor, translateEnvMap } from "../../utils/mcp-block.js";
import { buildPolicyCommentBlock } from "../../utils/policy-comments.js";
import { mapTools } from "../../utils/tool-mapper.js";
import type { FileArtifact, GenerationResult, ProjectBundle } from "../types.js";
import { buildRulesIndex } from "../shared/rules-index.js";

const EFFORT_MAP: Record<string, string> = { low: "low", medium: "medium", high: "high", max: "high" };

export function generateForgecode(project: ProjectBundle): GenerationResult {
  const artifacts: FileArtifact[] = [];

  // Agents under .forge/agents/
  for (const agent of enabledAgentsFor(project.agents, "forgecode")) {
    const fm = agent.frontmatter;
    const forgePlatform = fm.platforms?.forgecode;
    const tools = mapTools(fm.tools, "forgecode");
    const model = forgePlatform?.model ?? fm.model;

    const lines: string[] = ["---", `id: ${agent.name}`, `title: ${agent.name}`, `description: ${fm.description}`];
    if (model) lines.push(`model: ${model}`);
    if (fm.temperature !== undefined) lines.push(`temperature: ${fm.temperature}`);
    if (fm.maxTurns !== undefined) lines.push(`max_turns: ${fm.maxTurns}`);
    if (tools.length > 0) {
      lines.push("tools:");
      for (const tool of tools) lines.push(`  - ${tool}`);
    }
    if (fm.effort) {
      lines.push("reasoning:");
      lines.push("  enabled: true");
      lines.push(`  effort: ${EFFORT_MAP[fm.effort] ?? "medium"}`);
    }
    lines.push("---");

    const policyBlock = buildPolicyCommentBlock(fm, "md");
    const bodyWithPolicy = policyBlock ? `${policyBlock}\n${agent.body.trim()}` : agent.body.trim();
    artifacts.push({
      path: join(".forge", "agents", `${agent.name}.md`),
      contents: `${lines.join("\n")}\n\n${bodyWithPolicy}\n`,
    });
  }

  // MCP under .forge/.mcp.json
  const mcpServers: Record<string, Record<string, unknown>> = {};
  for (const [name, server] of mcpServersFor(project.mcp, "forgecode")) {
    if (server.type === "local") {
      const entry: Record<string, unknown> = {};
      if (server.command) entry.command = server.command;
      if (server.args) entry.args = server.args;
      const env = translateEnvMap(server.env, "forgecode");
      if (env) entry.env = env;
      if (server.enabled === false) entry.disable = true;
      mcpServers[name] = entry;
      continue;
    }
    if (!server.url) continue;
    const transportType = server.transport ?? "http";
    const entry: Record<string, unknown> = { type: transportType, url: server.url };
    const headers = translateEnvMap(server.headers, "forgecode");
    if (headers) entry.headers = headers;
    if (server.enabled === false) entry.disable = true;
    mcpServers[name] = entry;
  }
  artifacts.push({ path: join(".forge", ".mcp.json"), contents: JSON.stringify({ mcpServers }, null, 2) });

  // Rules: files + RULES.md index (written after raw merges — use appendAfterRaw with empty existing)
  const unsupportedPlatformRules = project.ulisConfig.unsupportedPlatformRules ?? "inject";
  const appendAfterRaw: { path: string; content: string }[] = [];
  if (unsupportedPlatformRules === "inject") {
    const result = buildRulesIndex(enabledRulesFor(project.rules, "forgecode"), {
      sourceDir: project.sourceDir,
      artifactPrefix: join(".forge", "rules"),
      indexPath: join(".forge", "RULES.md"),
    });
    if (result) {
      artifacts.push(...result.artifacts);
      appendAfterRaw.push(result.appendEntry);
    }
  }

  return {
    artifacts,
    post: {
      rawDirs: [join(project.sourceDir, "raw", "common"), join(project.sourceDir, "raw", "forgecode")],
      aliasFiles: [],
      skillDirs: enabledSkillsFor(project.skills, "forgecode").map((s) => ({ name: s.name, dir: s.dir })),
      skillsDestRelative: join(".forge", "skills"),
      appendAfterRaw,
    },
  };
}
