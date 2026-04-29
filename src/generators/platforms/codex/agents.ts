import { join } from "node:path";

import type { ParsedAgent } from "../../../parsers/agent.js";
import { buildPolicyCommentBlock } from "../../../utils/policy-comments.js";
import type { FileArtifact } from "../../types.js";
import { EFFORT_MAP, emitTomlExtra, toTomlString } from "./format.js";

export function buildCodexAgentArtifact(agent: ParsedAgent): FileArtifact {
  const codexPlatform = agent.frontmatter.platforms?.codex;

  // Destructure fields with special merge/derive logic; everything else passes through.
  const {
    enabled: _enabled,
    model: _model,
    model_reasoning_effort: _mre,
    sandbox_mode: _sandbox,
    nickname_candidates: _nicks,
    mcp_servers: _mcp,
    ...codexExtra
  } = (codexPlatform ?? {}) as Record<string, unknown>;

  const agentLines: string[] = [];

  agentLines.push(`name = ${toTomlString(agent.name)}`);
  agentLines.push(`description = ${toTomlString(agent.frontmatter.description)}`);
  agentLines.push("");
  agentLines.push(`developer_instructions = """`);
  agentLines.push(agent.body.trim());
  agentLines.push(`"""`);
  agentLines.push("");

  if (codexPlatform?.model) agentLines.push(`model = ${toTomlString(codexPlatform.model)}`);

  const reasoningEffort =
    codexPlatform?.model_reasoning_effort ??
    (agent.frontmatter.effort ? EFFORT_MAP[agent.frontmatter.effort] : undefined);
  if (reasoningEffort) agentLines.push(`model_reasoning_effort = ${toTomlString(reasoningEffort)}`);

  if (codexPlatform?.sandbox_mode) agentLines.push(`sandbox_mode = ${toTomlString(codexPlatform.sandbox_mode)}`);

  if (codexPlatform?.nickname_candidates?.length) {
    const nicks = codexPlatform.nickname_candidates.map((n) => toTomlString(n)).join(", ");
    agentLines.push(`nickname_candidates = [${nicks}]`);
  }

  emitTomlExtra(agentLines, codexExtra);

  const policyBlock = buildPolicyCommentBlock(agent.frontmatter, "toml");
  const contents = policyBlock ? `${policyBlock}\n${agentLines.join("\n")}` : agentLines.join("\n");
  return { path: join("agents", `${agent.name}.toml`), contents };
}
