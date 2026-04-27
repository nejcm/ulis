import { join } from "node:path";

import { enabledAgentsFor } from "../../parsers/agent.js";
import { enabledRulesFor } from "../../parsers/rule.js";
import { enabledSkillsFor } from "../../parsers/skill.js";
import { mcpServersFor, translateEnvMap } from "../../utils/mcp-block.js";
import { buildPolicyCommentBlock } from "../../utils/policy-comments.js";
import { mapTools } from "../../utils/tool-mapper.js";
import type { FileArtifact, GenerationResult, ProjectBundle } from "../types.js";
import { buildRulesIndex } from "../shared/rules-index.js";
import { extraToYamlLines } from "../shared/yaml.js";

const EFFORT_MAP: Record<string, string> = { low: "low", medium: "medium", high: "high", max: "high" };

export function generateForgecode(project: ProjectBundle): GenerationResult {
  const artifacts: FileArtifact[] = [];

  // Agents under .forge/agents/
  for (const agent of enabledAgentsFor(project.agents, "forgecode")) {
    const fm = agent.frontmatter;
    const forgePlatform = fm.platforms?.forgecode;

    // Destructure fields with special merge/derive logic; everything else passes through.
    const {
      enabled: _enabled,
      model: _model,
      temperature: _temperature,
      max_turns: _max_turns,
      reasoning: _reasoning,
      ...forgeExtra
    } = (forgePlatform ?? {}) as Record<string, unknown>;

    const tools = mapTools(fm.tools, "forgecode");
    const model = forgePlatform?.model ?? fm.model;
    const temperature = forgePlatform?.temperature ?? fm.temperature;
    const maxTurns = forgePlatform?.max_turns ?? fm.maxTurns;
    const reasoning =
      forgePlatform?.reasoning ??
      (fm.effort ? { enabled: true, effort: EFFORT_MAP[fm.effort] ?? "medium" } : undefined);

    const lines: string[] = ["---", `id: ${agent.name}`, `title: ${agent.name}`, `description: ${fm.description}`];
    if (model) lines.push(`model: ${model}`);
    if (temperature !== undefined) lines.push(`temperature: ${temperature}`);
    if (maxTurns !== undefined) lines.push(`max_turns: ${maxTurns}`);
    if (tools.length > 0) {
      lines.push("tools:");
      for (const tool of tools) lines.push(`  - ${tool}`);
    }
    if (reasoning) {
      const { enabled: _e, effort: _ef, max_tokens: _mt, exclude: _ex, ...reasoningExtra } =
        reasoning as Record<string, unknown>;
      lines.push("reasoning:");
      if ((reasoning as Record<string, unknown>).enabled !== undefined)
        lines.push(`  enabled: ${(reasoning as Record<string, unknown>).enabled}`);
      if ((reasoning as Record<string, unknown>).effort)
        lines.push(`  effort: ${(reasoning as Record<string, unknown>).effort}`);
      if ((reasoning as Record<string, unknown>).max_tokens !== undefined)
        lines.push(`  max_tokens: ${(reasoning as Record<string, unknown>).max_tokens}`);
      if ((reasoning as Record<string, unknown>).exclude !== undefined)
        lines.push(`  exclude: ${(reasoning as Record<string, unknown>).exclude}`);
      for (const line of extraToYamlLines(reasoningExtra)) lines.push(`  ${line}`);
    }
    lines.push(...extraToYamlLines(forgeExtra));
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
      skillDirs: enabledSkillsFor(project.skills, "forgecode").map((s) => {
        const p = s.frontmatter.platforms?.forgecode;
        const { enabled: _e, model: _m, ...extra } = (p ?? {}) as Record<string, unknown>;
        const model = p?.model ?? s.frontmatter.model;
        return { name: s.name, dir: s.dir, extraFrontmatter: { ...(model ? { model } : {}), ...extra } };
      }),
      skillsDestRelative: join(".forge", "skills"),
      appendAfterRaw,
    },
  };
}
