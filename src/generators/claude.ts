import { join } from "node:path";

import { type ParsedAgent, enabledAgentsFor } from "../parsers/agent.js";
import { parseCommands } from "../parsers/command.js";
import { type ParsedRule, enabledRulesFor } from "../parsers/rule.js";
import type { ParsedSkill } from "../parsers/skill.js";
import type { McpConfig, PermissionsConfig, PluginsConfig } from "../schema.js";
import { mergeOrCopyDir } from "../utils/config-merger.js";
import { cleanDir, fileExists, writeAgentsAliases, writeFile } from "../utils/fs.js";
import { log } from "../utils/logger.js";
import { mcpServersFor, normalizeLocalMcpCommand, translateEnvMap } from "../utils/mcp-block.js";
import { buildPolicyCommentBlock } from "../utils/policy-comments.js";
import { mapTools } from "../utils/tool-mapper.js";

function generateSubagentFrontmatter(agent: ParsedAgent): string {
  const { frontmatter: fm } = agent;
  const claudePlatform = fm.platforms?.claude;
  const lines: string[] = ["---"];

  lines.push(`name: ${agent.name}`);
  lines.push(`description: ${fm.description}`);

  const model = claudePlatform?.model ?? fm.model;
  if (model) {
    lines.push(`model: ${model}`);
  }

  const allowedTools = mapTools(fm.tools, "claude");

  // security.permissionLevel "readonly" → plan mode (read-only); toolPolicy.avoid → disallowedTools
  const disallowedTools = [...(claudePlatform?.disallowedTools ?? []), ...(fm.toolPolicy?.avoid ?? [])];

  if (allowedTools.length > 0) {
    lines.push(`tools: ${allowedTools.join(", ")}`);
  }
  if (disallowedTools.length > 0) {
    lines.push(`disallowedTools: ${[...new Set(disallowedTools)].join(", ")}`);
  }

  // Resolve permissionMode: security wins over platform override
  let permissionMode = claudePlatform?.permissionMode;
  if (fm.security?.permissionLevel === "readonly") {
    permissionMode = "plan";
  } else if (fm.security?.requireApproval?.length || fm.toolPolicy?.requireConfirmation?.length) {
    // requireApproval or requireConfirmation without readonly → default (ask on sensitive ops)
    permissionMode ??= "default";
  }
  if (permissionMode) {
    lines.push(`permissionMode: ${permissionMode}`);
  }

  if (fm.maxTurns !== undefined) {
    lines.push(`maxTurns: ${fm.maxTurns}`);
  }
  if (fm.effort) {
    lines.push(`effort: ${fm.effort}`);
  }
  if (fm.background) {
    lines.push(`background: true`);
  }
  if (fm.isolation && fm.isolation !== "none") {
    lines.push(`isolation: ${fm.isolation}`);
  }
  if (fm.memory && fm.memory !== "none") {
    lines.push(`memory: ${fm.memory}`);
  }
  if (fm.skills && fm.skills.length > 0) {
    lines.push(`skills:`);
    for (const s of fm.skills) {
      lines.push(`  - ${s}`);
    }
  }
  if (fm.mcpServers && fm.mcpServers.length > 0) {
    lines.push(`mcpServers:`);
    for (const s of fm.mcpServers) {
      lines.push(`  - ${s}`);
    }
  }
  // Merge explicit hooks + blocked-command hooks (security.blockedCommands → PreToolUse Bash deny)
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
      for (const entry of entries as Array<{
        matcher?: string;
        command: string;
      }>) {
        if (entry.matcher) {
          lines.push(`    - matcher: "${entry.matcher}"`);
          lines.push(`      hooks:`);
          lines.push(`        - type: command`);
          lines.push(`          command: "${entry.command}"`);
        } else {
          lines.push(`    - type: command`);
          lines.push(`      command: "${entry.command}"`);
        }
      }
    }
  }
  if (fm.color) {
    lines.push(`color: ${fm.color}`);
  }
  if (claudePlatform?.initialPrompt) {
    lines.push(`initialPrompt: ${claudePlatform.initialPrompt}`);
  }

  lines.push("---");
  return lines.join("\n");
}

export function generateClaude(
  agents: readonly ParsedAgent[],
  skills: readonly ParsedSkill[],
  mcp: McpConfig,
  plugins: PluginsConfig,
  aiDir: string,
  outDir: string,
  permissions: PermissionsConfig = {},
  rules: readonly ParsedRule[] = [],
): void {
  cleanDir(outDir);
  log.header("Claude Code");

  const enabledAgents = enabledAgentsFor(agents, "claude");

  // Generate native Claude Code subagent files (YAML frontmatter + body)
  let subagentCount = 0;
  for (const agent of enabledAgents) {
    const frontmatter = generateSubagentFrontmatter(agent);
    const policyBlock = buildPolicyCommentBlock(agent.frontmatter, "md");
    const bodyWithPolicy = policyBlock ? `${policyBlock}\n${agent.body.trim()}` : agent.body.trim();
    const content = `${frontmatter}\n\n${bodyWithPolicy}\n`;
    writeFile(join(outDir, "agents", `${agent.name}.md`), content);
    subagentCount++;
    if (policyBlock) {
      log.dim(`  agent: ${agent.name} (policy hints embedded)`);
    }
  }
  if (subagentCount > 0) {
    log.success(`agents/ (${subagentCount} subagents generated)`);
  }

  // Generate native Claude Code rule files (.claude/rules/<name>.md)
  const enabledRules = enabledRulesFor(rules, "claude");
  for (const rule of enabledRules) {
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
    const content = hasFrontmatter ? `${fmLines.join("\n")}\n\n${rule.body}\n` : `${rule.body}\n`;
    writeFile(join(outDir, "rules", rule.filename), content);
    log.dim(`  rule: ${rule.name}`);
  }
  if (enabledRules.length > 0) {
    log.success(`rules/ (${enabledRules.length} rules generated)`);
  }

  // Generate commands from .ulis/commands/
  const commandsSrc = join(aiDir, "commands");
  if (fileExists(commandsSrc)) {
    const parsedCmds = parseCommands(commandsSrc);
    for (const cmd of parsedCmds) {
      const fm = cmd.frontmatter as Record<string, unknown>;
      const claudePlatform = (fm.platforms as Record<string, unknown> | undefined)?.claude as
        | Record<string, unknown>
        | undefined;
      const resolvedModel = claudePlatform?.model ?? fm.model;

      const { platforms: _platforms, model: _model, ...rest } = fm;
      const outData: Record<string, unknown> = { ...rest };
      if (resolvedModel) outData.model = resolvedModel;

      const lines = ["---"];
      for (const [k, v] of Object.entries(outData)) {
        if (v === undefined || v === null) continue;
        if (typeof v === "boolean") lines.push(`${k}: ${v}`);
        else if (typeof v === "number") lines.push(`${k}: ${v}`);
        else if (Array.isArray(v)) lines.push(`${k}: ${JSON.stringify(v)}`);
        else lines.push(`${k}: ${v}`);
      }
      lines.push("---");

      writeFile(join(outDir, "commands", cmd.filename), `${lines.join("\n")}\n\n${cmd.body}\n`);
    }
    log.success(`commands/ (${parsedCmds.length} commands generated)`);
  }

  // Build MCP servers block
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
      log.dim(`  mcp: ${name} (local)`);
    } else if (server.url) {
      const transportType = server.transport ?? "http";
      const entry: Record<string, unknown> = {
        type: transportType,
        url: server.url,
      };
      const headers = translateEnvMap(server.headers, "claude");
      if (headers) entry.headers = headers;
      mcpServers[name] = entry;
      log.dim(`  mcp: ${name} (remote/${transportType})`);
    }
  }

  // Build settings.json (Claude MCP servers live in .claude.json)
  const enabledPlugins: Record<string, boolean> = {};
  const extraKnownMarketplaces: Record<string, unknown> = {};

  for (const plugin of plugins?.claude?.plugins ?? []) {
    if (plugin.source === "github" && plugin.repo) {
      const key = `${plugin.name}@${plugin.name}`;
      enabledPlugins[key] = true;
      extraKnownMarketplaces[plugin.name] = {
        source: { source: "github", repo: plugin.repo },
      };
    } else if (plugin.source === "official") {
      enabledPlugins[`${plugin.name}@claude-plugins-official`] = true;
    }
  }

  // Build permissions block from permissions.json
  const permissionsBlock: Record<string, unknown> = {};
  if (permissions?.claude) {
    const cp = permissions.claude;
    if (cp.defaultMode) permissionsBlock.defaultMode = cp.defaultMode;
    if (cp.allow?.length) permissionsBlock.allow = cp.allow;
    if (cp.deny?.length) permissionsBlock.deny = cp.deny;
    if (cp.ask?.length) permissionsBlock.ask = cp.ask;
    if (cp.additionalDirectories?.length) permissionsBlock.additionalDirectories = cp.additionalDirectories;
  }

  const settings: Record<string, unknown> = {
    enabledPlugins,
  };
  if (Object.keys(extraKnownMarketplaces).length > 0) {
    settings.extraKnownMarketplaces = extraKnownMarketplaces;
  }
  if (Object.keys(permissionsBlock).length > 0) {
    settings.permissions = permissionsBlock;
  }

  writeFile(join(outDir, "settings.json"), JSON.stringify(settings, null, 2));
  log.success("settings.json");
  if (Object.keys(mcpServers).length > 0) {
    writeFile(join(outDir, ".claude.json"), JSON.stringify({ mcpServers }, null, 2));
    log.success(".claude.json");
  }

  // Merge raw files into output (common first, then platform-specific to allow overrides)
  const rawCommon = join(aiDir, "raw", "common");
  if (fileExists(rawCommon)) {
    mergeOrCopyDir(rawCommon, outDir);
    log.success("raw/common/");
  }
  const rawPlatform = join(aiDir, "raw", "claude");
  if (fileExists(rawPlatform)) {
    mergeOrCopyDir(rawPlatform, outDir);
    log.success("raw/claude/");
  }

  const aliases = writeAgentsAliases(outDir, ["CLAUDE.md"]);
  for (const alias of aliases) log.success(alias);
}
