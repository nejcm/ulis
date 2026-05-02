import { join } from "node:path";

import type { ParsedAgent } from "../../../parsers/agent.js";
import { buildPolicyCommentBlock } from "../../../utils/policy-comments.js";
import { mapTools } from "../../../utils/tool-mapper.js";
import { extraToYamlLines } from "../../shared/yaml";
import type { FileArtifact } from "../../types.js";

export function buildCursorAgentArtifact(agent: ParsedAgent): FileArtifact {
  const { frontmatter: fm } = agent;
  const cursorPlatform = fm.platforms?.cursor;

  const {
    enabled: _enabled,
    model: _model,
    readonly: _readonly,
    is_background: _is_background,
    ...cursorExtra
  } = (cursorPlatform ?? {}) as Record<string, unknown>;

  const model = cursorPlatform?.model ?? fm.model;
  const tools = mapTools(fm.tools, "cursor");

  const isReadonly = cursorPlatform?.readonly ?? fm.security?.permissionLevel === "readonly";
  const isBackground = cursorPlatform?.is_background ?? fm.background ?? false;

  const lines = ["---", `description: ${fm.description}`];
  if (model) lines.push(`model: ${model}`);
  if (isReadonly) lines.push(`readonly: true`);
  if (isBackground) lines.push(`is_background: true`);
  if (tools.length > 0) {
    lines.push(`tools:`);
    for (const tool of tools) lines.push(`  - ${tool}`);
  }
  lines.push(...extraToYamlLines(cursorExtra));
  lines.push("---");

  const policyBlock = buildPolicyCommentBlock(fm, "mdc");
  const bodyWithPolicy = policyBlock ? `${policyBlock}\n${agent.body.trim()}` : agent.body.trim();
  return {
    path: join("agents", `${agent.name}.mdc`),
    contents: `${lines.join("\n")}\n\n${bodyWithPolicy}\n`,
  };
}
