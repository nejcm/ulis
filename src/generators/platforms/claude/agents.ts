import { join } from "node:path";

import type { ParsedAgent } from "../../../parsers/agent.js";
import { buildPolicyCommentBlock } from "../../../utils/policy-comments.js";
import { mapTools } from "../../../utils/tool-mapper.js";
import { extraToYamlLines, toYamlScalar } from "../../shared/yaml";
import type { FileArtifact } from "../../types.js";

/** Serialize the YAML frontmatter block for a Claude subagent. */
function subagentFrontmatter(agent: ParsedAgent): string {
  const { frontmatter: fm } = agent;
  const claudePlatform = fm.platforms?.claude;

  // Destructure known/specially-handled fields; the rest pass through verbatim.
  const {
    enabled: _enabled,
    model: _model,
    permissionMode: _permissionMode,
    disallowedTools: _disallowedTools,
    initialPrompt: _initialPrompt,
    ...claudeExtra
  } = (claudePlatform ?? {}) as Record<string, unknown>;

  const lines: string[] = ["---"];

  lines.push(`name: ${toYamlScalar(agent.name)}`);
  lines.push(`description: ${toYamlScalar(fm.description)}`);

  const model = claudePlatform?.model ?? fm.model;
  if (model) lines.push(`model: ${toYamlScalar(model)}`);

  const allowedTools = mapTools(fm.tools, "claude");
  const disallowedTools = [...(claudePlatform?.disallowedTools ?? []), ...(fm.toolPolicy?.avoid ?? [])];

  if (allowedTools.length > 0) lines.push(`tools: ${toYamlScalar(allowedTools.join(", "))}`);
  if (disallowedTools.length > 0) {
    lines.push(`disallowedTools: ${toYamlScalar([...new Set(disallowedTools)].join(", "))}`);
  }

  let permissionMode = claudePlatform?.permissionMode;
  if (fm.security?.permissionLevel === "readonly") {
    permissionMode = "plan";
  } else if (fm.security?.requireApproval?.length || fm.toolPolicy?.requireConfirmation?.length) {
    permissionMode ??= "default";
  }
  if (permissionMode) lines.push(`permissionMode: ${toYamlScalar(permissionMode)}`);

  if (fm.maxTurns !== undefined) lines.push(`maxTurns: ${fm.maxTurns}`);
  if (fm.effort) lines.push(`effort: ${fm.effort}`);
  if (fm.background) lines.push(`background: true`);
  if (fm.isolation && fm.isolation !== "none") lines.push(`isolation: ${fm.isolation}`);
  if (fm.memory && fm.memory !== "none") lines.push(`memory: ${fm.memory}`);

  if (fm.skills && fm.skills.length > 0) {
    lines.push(`skills:`);
    for (const s of fm.skills) lines.push(`  - ${toYamlScalar(s)}`);
  }
  if (fm.mcpServers && fm.mcpServers.length > 0) {
    lines.push(`mcpServers:`);
    for (const s of fm.mcpServers) lines.push(`  - ${toYamlScalar(s)}`);
  }

  // Merge explicit hooks with blocked-command hooks derived from security policy.
  const blockedCmds = fm.security?.blockedCommands ?? [];
  const blockedHookEntries = blockedCmds.map((cmd) => ({
    matcher: `Bash(${cmd}*)`,
    command: `echo "Blocked by ULIS security policy: ${cmd}" && exit 1`,
  }));
  const mergedPreToolUse = [...(fm.hooks?.PreToolUse ?? []), ...blockedHookEntries];
  const mergedHooks = {
    ...(fm.hooks ?? {}),
    ...(mergedPreToolUse.length > 0 ? { PreToolUse: mergedPreToolUse } : {}),
  };

  const hasHooks = Object.values(mergedHooks).some((v) => Array.isArray(v) && v.length > 0);
  if (hasHooks) {
    lines.push(`hooks:`);
    for (const [event, entries] of Object.entries(mergedHooks)) {
      if (!entries || (entries as unknown[]).length === 0) continue;
      lines.push(`  ${event}:`);
      for (const entry of entries as Array<{ matcher?: string; command: string }>) {
        if (entry.matcher) {
          lines.push(`    - matcher: ${toYamlScalar(entry.matcher)}`);
          lines.push(`      hooks:`);
          lines.push(`        - type: command`);
          lines.push(`          command: ${toYamlScalar(entry.command)}`);
        } else {
          lines.push(`    - type: command`);
          lines.push(`      command: ${toYamlScalar(entry.command)}`);
        }
      }
    }
  }

  if (fm.color) lines.push(`color: ${toYamlScalar(fm.color)}`);
  if (claudePlatform?.initialPrompt) lines.push(`initialPrompt: ${toYamlScalar(claudePlatform.initialPrompt)}`);

  lines.push(...extraToYamlLines(claudeExtra));

  lines.push("---");
  return lines.join("\n");
}

export function buildClaudeAgentArtifact(agent: ParsedAgent): FileArtifact {
  const frontmatter = subagentFrontmatter(agent);
  const policyBlock = buildPolicyCommentBlock(agent.frontmatter, "md");
  const bodyWithPolicy = policyBlock ? `${policyBlock}\n${agent.body.trim()}` : agent.body.trim();
  return {
    path: join("agents", `${agent.name}.md`),
    contents: `${frontmatter}\n\n${bodyWithPolicy}\n`,
  };
}
