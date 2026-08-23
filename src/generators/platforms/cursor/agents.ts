import { join } from "node:path";

import type { ParsedAgent } from "../../../parsers/agent.js";
import { buildPolicyCommentBlock } from "../../../utils/policy-comments.js";
import { mapTools } from "../../../utils/tool-mapper.js";
import { serializeYamlFrontmatter } from "../../shared/yaml.js";
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

  const frontmatter = serializeYamlFrontmatter({
    description: fm.description,
    model: model || undefined,
    readonly: isReadonly || undefined,
    is_background: isBackground || undefined,
    tools: tools.length > 0 ? tools : undefined,
    ...cursorExtra,
  });

  const policyBlock = buildPolicyCommentBlock(fm, "mdc");
  const bodyWithPolicy = policyBlock ? `${policyBlock}\n${agent.body.trim()}` : agent.body.trim();
  return {
    path: join("agents", `${agent.name}.mdc`),
    contents: `${frontmatter}\n\n${bodyWithPolicy}\n`,
  };
}
