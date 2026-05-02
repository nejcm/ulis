import { join } from "node:path";

import type { ParsedAgent } from "../../../parsers/agent.js";
import { buildPolicyCommentBlock } from "../../../utils/policy-comments.js";
import { mapTools } from "../../../utils/tool-mapper.js";
import { extraToYamlLines } from "../../shared/yaml";
import type { FileArtifact } from "../../types.js";

const EFFORT_MAP: Record<string, string> = { low: "low", medium: "medium", high: "high", max: "high" };

export function buildForgecodeAgentArtifact(agent: ParsedAgent): FileArtifact {
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
    forgePlatform?.reasoning ?? (fm.effort ? { enabled: true, effort: EFFORT_MAP[fm.effort] ?? "medium" } : undefined);

  const lines: string[] = ["---", `id: ${agent.name}`, `title: ${agent.name}`, `description: ${fm.description}`];
  if (model) lines.push(`model: ${model}`);
  if (temperature !== undefined) lines.push(`temperature: ${temperature}`);
  if (maxTurns !== undefined) lines.push(`max_turns: ${maxTurns}`);
  if (tools.length > 0) {
    lines.push("tools:");
    for (const tool of tools) lines.push(`  - ${tool}`);
  }
  if (reasoning) {
    const {
      enabled: _e,
      effort: _ef,
      max_tokens: _mt,
      exclude: _ex,
      ...reasoningExtra
    } = reasoning as Record<string, unknown>;
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
  return {
    path: join(".forge", "agents", `${agent.name}.md`),
    contents: `${lines.join("\n")}\n\n${bodyWithPolicy}\n`,
  };
}
