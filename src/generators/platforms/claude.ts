import { join } from "node:path";

import { type ParsedAgent, enabledAgentsFor } from "../../parsers/agent.js";
import { parseCommands } from "../../parsers/command.js";
import { enabledRulesFor } from "../../parsers/rule.js";
import { fileExists } from "../../utils/fs.js";
import { mcpServersFor, normalizeLocalMcpCommand, translateEnvMap } from "../../utils/mcp-block.js";
import { buildPolicyCommentBlock } from "../../utils/policy-comments.js";
import { mapTools } from "../../utils/tool-mapper.js";
import type { FileArtifact, GenerationResult, ProjectBundle } from "../types.js";
import { toYamlScalar, serializeYamlFrontmatter, extraToYamlLines } from "../shared/yaml.js";

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

function agentArtifact(agent: ParsedAgent): FileArtifact {
  const frontmatter = subagentFrontmatter(agent);
  const policyBlock = buildPolicyCommentBlock(agent.frontmatter, "md");
  const bodyWithPolicy = policyBlock ? `${policyBlock}\n${agent.body.trim()}` : agent.body.trim();
  return {
    path: join("agents", `${agent.name}.md`),
    contents: `${frontmatter}\n\n${bodyWithPolicy}\n`,
  };
}

function buildMcpBlock(mcp: ProjectBundle["mcp"]): Record<string, unknown> {
  const mcpServers: Record<string, unknown> = {};
  for (const [name, server] of mcpServersFor(mcp, "claude")) {
    if (server.type === "local") {
      const entry: Record<string, unknown> = {};
      const { command, args } = normalizeLocalMcpCommand(server, "claude");
      if (command) entry.command = command;
      if (args) entry.args = args;
      const env = translateEnvMap(server.env, "claude");
      if (env) entry.env = env;
      mcpServers[name] = entry;
    } else if (server.url) {
      const transportType = server.transport ?? "http";
      const entry: Record<string, unknown> = { type: transportType, url: server.url };
      const headers = translateEnvMap(server.headers, "claude");
      if (headers) entry.headers = headers;
      mcpServers[name] = entry;
    }
  }
  return mcpServers;
}


function buildSettings(
  permissions: ProjectBundle["permissions"],
  plugins: ProjectBundle["plugins"],
): Record<string, unknown> {
  const enabledPlugins: Record<string, boolean> = {};
  const extraKnownMarketplaces: Record<string, unknown> = {};

  for (const plugin of plugins?.claude?.plugins ?? []) {
    if (plugin.source === "github" && plugin.repo) {
      enabledPlugins[`${plugin.name}@${plugin.name}`] = true;
      extraKnownMarketplaces[plugin.name] = {
        source: { source: "github", repo: plugin.repo },
      };
    } else if (plugin.source === "official") {
      enabledPlugins[`${plugin.name}@claude-plugins-official`] = true;
    }
  }

  const permissionsBlock: Record<string, unknown> = {};
  if (permissions?.claude) {
    const cp = permissions.claude;
    if (cp.defaultMode) permissionsBlock.defaultMode = cp.defaultMode;
    if (cp.allow?.length) permissionsBlock.allow = cp.allow;
    if (cp.deny?.length) permissionsBlock.deny = cp.deny;
    if (cp.ask?.length) permissionsBlock.ask = cp.ask;
    if (cp.additionalDirectories?.length) permissionsBlock.additionalDirectories = cp.additionalDirectories;
  }

  const settings: Record<string, unknown> = { enabledPlugins };
  if (Object.keys(extraKnownMarketplaces).length > 0) {
    settings.extraKnownMarketplaces = extraKnownMarketplaces;
  }
  if (Object.keys(permissionsBlock).length > 0) {
    settings.permissions = permissionsBlock;
  }
  return settings;
}

export function generateClaude(project: ProjectBundle): GenerationResult {
  const artifacts: FileArtifact[] = [];

  // Agents
  for (const agent of enabledAgentsFor(project.agents, "claude")) {
    artifacts.push(agentArtifact(agent));
  }

  // Rules: native Claude Code rule files under rules/<name>.md
  for (const rule of enabledRulesFor(project.rules, "claude")) {
    const fm = rule.frontmatter;
    const fmLines: string[] = ["---"];
    if (fm.description) fmLines.push(`description: ${fm.description}`);
    if (fm.paths?.length) {
      fmLines.push("paths:");
      for (const p of fm.paths) fmLines.push(`  - "${p}"`);
    }
    if (fm.alwaysApply) fmLines.push("alwaysApply: true");
    fmLines.push("---");
    const hasFrontmatter = fm.description || fm.paths?.length || fm.alwaysApply;
    const contents = hasFrontmatter ? `${fmLines.join("\n")}\n\n${rule.body}\n` : `${rule.body}\n`;
    artifacts.push({ path: join("rules", rule.filename), contents });
  }

  // Commands (parsed on demand; output under commands/<name>.md)
  const commandsSrc = join(project.sourceDir, "commands");
  if (fileExists(commandsSrc)) {
    for (const cmd of parseCommands(commandsSrc)) {
      const fm = cmd.frontmatter as Record<string, unknown>;
      const claudePlatform = (fm.platforms as Record<string, unknown> | undefined)?.claude as
        | Record<string, unknown>
        | undefined;
      const { enabled: _e, model: _cm, ...claudeExtra } = claudePlatform ?? {};
      const resolvedModel = (claudePlatform?.model ?? fm.model) as string | undefined;

      const { platforms: _platforms, model: _model, ...rest } = fm;
      const outData: Record<string, unknown> = { ...rest, ...claudeExtra };
      if (resolvedModel) outData.model = resolvedModel;

      artifacts.push({
        path: join("commands", cmd.filename),
        contents: `${serializeYamlFrontmatter(outData)}\n\n${cmd.body}\n`,
      });
    }
  }

  // settings.json (always emitted — mirrors legacy behavior)
  const settings = buildSettings(project.permissions, project.plugins);
  artifacts.push({ path: "settings.json", contents: JSON.stringify(settings, null, 2) });

  // .claude.json (MCP servers) — only when non-empty
  const mcpServers = buildMcpBlock(project.mcp);
  if (Object.keys(mcpServers).length > 0) {
    artifacts.push({ path: ".claude.json", contents: JSON.stringify({ mcpServers }, null, 2) });
  }

  return {
    artifacts,
    post: {
      rawDirs: [join(project.sourceDir, "raw", "common"), join(project.sourceDir, "raw", "claude")],
      aliasFiles: ["CLAUDE.md"],
      skillDirs: [],
    },
  };
}
