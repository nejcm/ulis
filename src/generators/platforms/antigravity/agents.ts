import { join } from "node:path";

import type { ParsedAgent } from "../../../parsers/agent.js";
import type { ToolPermissions } from "../../../schema.js";
import { buildPolicyCommentBlock, sanitizeInstructionText } from "../../../utils/policy-comments.js";
import { mapTools } from "../../../utils/tool-mapper.js";
import { serializeYamlFrontmatter } from "../../shared/yaml.js";
import type { FileArtifact } from "../../types.js";

const UNMAPPABLE_CAPABILITIES = ["write", "search", "browser"] as const;

function unmappedTools(perms: ToolPermissions): string[] {
  if (typeof perms === "string")
    return perms
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  return UNMAPPABLE_CAPABILITIES.filter((capability) => perms[capability]);
}

function unmappedToolsComment(perms: ToolPermissions): string {
  const names = unmappedTools(perms);
  if (names.length === 0) return "";
  return `<!--\n  [ULIS tools]\n    unmapped on antigravity: ${sanitizeInstructionText(names.join(", "))}\n-->\n`;
}

export function buildAntigravityAgentArtifact(agent: ParsedAgent): FileArtifact {
  const { frontmatter: fm } = agent;
  const antigravityPlatform = fm.platforms?.antigravity;
  const { enabled: _enabled, tools: nativeTools, ...extra } = (antigravityPlatform ?? {}) as Record<string, unknown>;

  const frontmatter = serializeYamlFrontmatter({
    name: agent.name,
    description: fm.description,
    tools: antigravityPlatform?.tools ?? mapTools(fm.tools, "antigravity"),
    skills: fm.skills?.length ? fm.skills.map((name) => `skills/${name}`) : undefined,
    ...extra,
  });

  const comments = [nativeTools ? "" : unmappedToolsComment(fm.tools), buildPolicyCommentBlock(fm, "md")]
    .filter(Boolean)
    .join("\n");
  const bodyWithPolicy = comments ? `${comments}\n${agent.body.trim()}` : agent.body.trim();
  return {
    path: join("agents", `${agent.name}.md`),
    contents: `${frontmatter}\n\n${bodyWithPolicy}\n`,
  };
}
