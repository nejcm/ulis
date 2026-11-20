import { join } from "node:path";

import type { ParsedAgent } from "../../../parsers/agent.js";
import type { ToolPermissions } from "../../../schema.js";
import { buildPolicyCommentBlock, sanitizeInstructionText } from "../../../utils/policy-comments.js";
import { mapTools } from "../../../utils/tool-mapper.js";
import { serializeYamlFrontmatter } from "../../shared/yaml.js";
import type { FileArtifact } from "../../types.js";

const EVERY_TOOL = mapTools({ read: true, write: true, edit: true, bash: true, search: true, browser: true }, "devin");

/** Native list from `platforms.devin`, where Devin accepts `tools` as an alias of `allowed-tools`. */
export function nativeDevinTools(agent: ParsedAgent): unknown {
  const devin = agent.frontmatter.platforms?.devin as Record<string, unknown> | undefined;
  return devin?.["allowed-tools"] ?? devin?.tools;
}

/** Devin `allowed-tools` for canonical tools; undefined when every tool group is granted, since omission means all tools. */
export function devinAllowedTools(perms: ToolPermissions): string[] | undefined {
  const tools = mapTools(perms, "devin");
  // Subagent tools are left out of the check: Devin disables them inside a subagent unless `max-nesting` is set.
  return EVERY_TOOL.every((tool) => tools.includes(tool)) ? undefined : tools;
}

/** Canonical tools that map to no Devin tool, leaving `allowed-tools` empty, so it is omitted and Devin grants every tool. */
export function unmappedDevinTools(agent: ParsedAgent): string[] | undefined {
  const perms = agent.frontmatter.tools;
  if (nativeDevinTools(agent) !== undefined || mapTools(perms, "devin").length > 0) return undefined;
  if (typeof perms !== "string") return [];
  return perms
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function buildDevinAgentArtifact(agent: ParsedAgent): FileArtifact {
  const { frontmatter: fm } = agent;
  const {
    enabled: _enabled,
    "allowed-tools": _allowedTools,
    tools: _tools,
    ...extra
  } = (fm.platforms?.devin ?? {}) as Record<string, unknown>;
  const nativeTools = nativeDevinTools(agent);
  const mapped = devinAllowedTools(fm.tools);

  const frontmatter = serializeYamlFrontmatter({
    name: agent.name,
    description: fm.description,
    "allowed-tools": nativeTools ?? (mapped?.length ? mapped : undefined),
    ...extra,
  });

  const unmapped = unmappedDevinTools(agent);
  const toolsComment = unmapped
    ? `<!-- [ULIS tools] canonical: ${sanitizeInstructionText(unmapped.join(", ") || "none")}; allowed-tools omitted -->\n`
    : "";
  const comments = [toolsComment, buildPolicyCommentBlock(fm, "md")].filter(Boolean).join("\n");
  const body = comments ? `${comments}\n${agent.body.trim()}` : agent.body.trim();
  return { path: join("agents", `${agent.name}.md`), contents: `${frontmatter}\n\n${body}\n` };
}
