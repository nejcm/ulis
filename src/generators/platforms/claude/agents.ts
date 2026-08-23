import { join } from "node:path";

import type { ParsedAgent } from "../../../parsers/agent.js";
import { buildPolicyCommentBlock } from "../../../utils/policy-comments.js";
import { mapTools } from "../../../utils/tool-mapper.js";
import { blockedCommandHooks } from "../../shared/security-hooks.js";
import { partitionReservedExtras, serializeYamlFrontmatter } from "../../shared/yaml.js";
import type { FileArtifact } from "../../types.js";

/**
 * Every frontmatter key this generator may emit, reserved against pass-through extras whether or
 * not a given agent produces it. Reserving only what one run emitted would leave `hooks` free on
 * any agent that declared none — the exact field the security policy fills in — so the list is
 * declared once here and checked against the built object below.
 */
const CLAUDE_GENERATED_KEYS = new Set([
  "name",
  "description",
  "model",
  "tools",
  "disallowedTools",
  "permissionMode",
  "maxTurns",
  "effort",
  "background",
  "isolation",
  "memory",
  "skills",
  "mcpServers",
  "hooks",
  "color",
  "initialPrompt",
]);

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

  // Built as a plain object and serialized once: every value — including the pass-through extras —
  // goes through the shared escaping path, so none of them can forge a sibling frontmatter key.
  const data: Record<string, unknown> = {};

  data.name = agent.name;
  data.description = fm.description;

  const model = claudePlatform?.model ?? fm.model;
  if (model) data.model = model;

  const allowedTools = mapTools(fm.tools, "claude");
  const disallowedTools = [...(claudePlatform?.disallowedTools ?? []), ...(fm.toolPolicy?.avoid ?? [])];

  if (allowedTools.length > 0) data.tools = allowedTools.join(", ");
  if (disallowedTools.length > 0) {
    data.disallowedTools = [...new Set(disallowedTools)].join(", ");
  }

  let permissionMode = claudePlatform?.permissionMode;
  if (fm.security?.permissionLevel === "readonly") {
    permissionMode = "plan";
  } else if (fm.security?.requireApproval?.length || fm.toolPolicy?.requireConfirmation?.length) {
    permissionMode ??= "default";
  }
  if (permissionMode) data.permissionMode = permissionMode;

  if (fm.maxTurns !== undefined) data.maxTurns = fm.maxTurns;
  if (fm.effort) data.effort = fm.effort;
  if (fm.background) data.background = true;
  if (fm.isolation && fm.isolation !== "none") data.isolation = fm.isolation;
  if (fm.memory && fm.memory !== "none") data.memory = fm.memory;

  if (fm.skills && fm.skills.length > 0) data.skills = [...fm.skills];
  if (fm.mcpServers && fm.mcpServers.length > 0) data.mcpServers = [...fm.mcpServers];

  // Merge explicit hooks with blocked-command hooks derived from security policy. The derivation
  // lives in `blockedCommandHooks` so the trust preview enumerates exactly what is generated here.
  const mergedPreToolUse = [...(fm.hooks?.PreToolUse ?? []), ...blockedCommandHooks(fm.security)];
  const mergedHooks = {
    ...(fm.hooks ?? {}),
    ...(mergedPreToolUse.length > 0 ? { PreToolUse: mergedPreToolUse } : {}),
  };

  const hasHooks = Object.values(mergedHooks).some((v) => Array.isArray(v) && v.length > 0);
  if (hasHooks) {
    const hooks: Record<string, unknown> = {};
    for (const [event, entries] of Object.entries(mergedHooks)) {
      if (!entries || (entries as unknown[]).length === 0) continue;
      hooks[event] = (entries as Array<{ matcher?: string; command: string }>).map((entry) =>
        entry.matcher
          ? { matcher: entry.matcher, hooks: [{ type: "command", command: entry.command }] }
          : { type: "command", command: entry.command },
      );
    }
    data.hooks = hooks;
  }

  if (fm.color) data.color = fm.color;
  if (claudePlatform?.initialPrompt) data.initialPrompt = claudePlatform.initialPrompt;

  // Keeps `CLAUDE_GENERATED_KEYS` honest: a field added above but not declared there would other-
  // wise be reserved on the runs that emit it and claimable by an extra on the runs that do not.
  for (const key of Object.keys(data)) {
    if (!CLAUDE_GENERATED_KEYS.has(key)) {
      throw new Error(`Claude frontmatter key is not declared in CLAUDE_GENERATED_KEYS: ${key}`);
    }
  }

  // Pass-through extras land last, and an extra that names a key ULIS owns is dropped: the
  // generated `hooks` and `tools` carry the security policy, so the source side must not win.
  const { extras, notes } = partitionReservedExtras(claudeExtra, CLAUDE_GENERATED_KEYS);
  Object.assign(data, extras);

  return serializeYamlFrontmatter(data, notes);
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
