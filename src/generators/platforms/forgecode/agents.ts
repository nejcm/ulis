import { join } from "node:path";

import type { ParsedAgent } from "../../../parsers/agent.js";
import { buildPolicyCommentBlock } from "../../../utils/policy-comments.js";
import { mapTools } from "../../../utils/tool-mapper.js";
import { serializeYamlFrontmatter } from "../../shared/yaml.js";
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

  const { enabled, effort, max_tokens, exclude, ...reasoningExtra } = (reasoning ?? {}) as Record<string, unknown>;
  const frontmatter = serializeYamlFrontmatter({
    id: agent.name,
    title: agent.name,
    description: fm.description,
    model: model || undefined,
    temperature,
    max_turns: maxTurns,
    tools: tools.length > 0 ? tools : undefined,
    reasoning: reasoning ? { enabled, effort, max_tokens, exclude, ...reasoningExtra } : undefined,
    ...forgeExtra,
  });

  const policyBlock = buildPolicyCommentBlock(fm, "md");
  const bodyWithPolicy = policyBlock ? `${policyBlock}\n${agent.body.trim()}` : agent.body.trim();
  return {
    path: join(".forge", "agents", `${agent.name}.md`),
    contents: `${frontmatter}\n\n${bodyWithPolicy}\n`,
  };
}
