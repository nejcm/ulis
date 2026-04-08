import { join } from "node:path";

import type { BuildConfig } from "../config.js";
import { type ParsedAgent, enabledAgentsFor } from "../parsers/agent.js";
import { type ParsedSkill, enabledSkillsFor } from "../parsers/skill.js";
import type { McpConfig, PluginsConfig, ToolPermissions } from "../schema.js";
import { cleanDir, copyDir, fileExists, readFile, writeFile } from "../utils/fs.js";
import { log } from "../utils/logger.js";
import { mcpServersFor, translateEnvMap } from "../utils/mcp-block.js";
import { buildPolicyCommentBlock } from "../utils/policy-comments.js";
import { mapTools } from "../utils/tool-mapper.js";

function generateSubagentFrontmatter(agent: ParsedAgent, cfg: BuildConfig): string {
  const { frontmatter: fm } = agent;
  const claudePlatform = fm.platforms?.claude;
  const lines: string[] = ["---"];

  lines.push(`name: ${agent.name}`);
  lines.push(`description: ${fm.description}`);

  const model = cfg.platforms.claude.modelMap[fm.model] ?? fm.model;
  if (model && model !== "inherit") {
    lines.push(`model: ${model}`);
  }

  const allowedTools = mapTools(fm.tools, "claude", cfg);

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
      for (const entry of entries as Array<{ matcher?: string; command: string }>) {
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
  cfg: BuildConfig,
): void {
  cleanDir(outDir);
  log.header("Claude Code");

  // Generate agents orchestration table into rules/common/agents.md
  const enabledAgents = enabledAgentsFor(agents, "claude");

  const agentRows = enabledAgents.map((a) => `| ${a.name} | ${a.frontmatter.description} | ${a.frontmatter.model} |`);

  const agentsRule = `# Agent Orchestration

## Available Agents

| Agent | Purpose | Model |
|-------|---------|-------|
${agentRows.join("\n")}

## Immediate Agent Usage

No user prompt needed:
1. Complex feature requests - Use **planner** agent
2. Code just written/modified - Use **reviewer** agent
3. Bug fix or new feature - Use **tester** agent (TDD)
4. Architectural decision - Use **architect** agent
5. Security-sensitive changes - Use **security** agent

## Parallel Task Execution

ALWAYS use parallel execution for independent operations:
- Launch multiple agents concurrently when tasks don't depend on each other
- Example: Security analysis + Performance review + Code review in parallel

## Multi-Perspective Analysis

For complex problems, use split role sub-agents:
- Factual reviewer
- Senior engineer
- Security expert
- Consistency reviewer
`;

  writeFile(join(outDir, "rules", "common", "agents.md"), agentsRule);
  log.success("rules/common/agents.md (generated)");

  // Copy guardrails as a rule
  const guardrailsSrc = join(aiDir, "guardrails.md");
  if (fileExists(guardrailsSrc)) {
    writeFile(join(outDir, "rules", "common", "guardrails.md"), readFile(guardrailsSrc));
    log.success("rules/common/guardrails.md");
  }

  // Copy workflows as rules
  const workflowsSrc = join(aiDir, "workflows");
  if (fileExists(workflowsSrc)) {
    copyDir(workflowsSrc, join(outDir, "rules", "workflows"));
    log.success("rules/workflows/");
  }

  const rulesReadme = `# Rules

Instruction files for Claude Code. The build writes this tree under \`generated/claude/\`; the install script can deploy it to \`~/.claude/rules/\`, where Claude Code loads Markdown rules.

## What the build produces

| Path | Source |
|------|--------|
| \`common/agents.md\` | Generated orchestration table from \`.ai/agents/*.md\` |
| \`common/guardrails.md\` | Copied from \`.ai/guardrails.md\` when present |
| \`workflows/\` | Copied from \`.ai/workflows/\` when present |

There is no \`.ai/rules/\` directory in this repo. Add guidance via \`guardrails.md\`, workflows, or agent prompts, then run \`bun run build:claude\`.

## File format

Each rule is a Markdown file with optional YAML frontmatter (for example \`paths\` globs to scope when Claude applies the rule). Rules without \`paths\` apply globally.

Rules are **not** used by OpenCode, Codex, or Cursor — those tools use agents and MCP configs instead.
`;
  writeFile(join(outDir, "rules", "README.md"), rulesReadme);
  log.success("rules/README.md");

  // Copy commands (Claude Code native slash commands)
  const commandsSrc = join(aiDir, "commands");
  if (fileExists(commandsSrc)) {
    copyDir(commandsSrc, join(outDir, "commands"));
    log.success("commands/");
  }

  // Generate native Claude Code subagent files (YAML frontmatter + body)
  let subagentCount = 0;
  for (const agent of enabledAgents) {
    const frontmatter = generateSubagentFrontmatter(agent, cfg);
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

  // Also generate agent commands (slash commands) for backward compat
  let agentCommandCount = 0;
  for (const agent of enabledAgents) {
    const model = cfg.platforms.claude.modelMap[agent.frontmatter.model] ?? agent.frontmatter.model;
    const allowedTools = mapTools(agent.frontmatter.tools, "claude", cfg);

    const frontmatterLines = ["---", `description: ${agent.frontmatter.description}`, `model: ${model}`];
    if (allowedTools.length > 0) {
      frontmatterLines.push(`allowed-tools: ${allowedTools.join(", ")}`);
    }
    frontmatterLines.push("---");

    const commandContent = `${frontmatterLines.join("\n")}\n\n${agent.body}\n`;
    writeFile(join(outDir, "commands", `${agent.name}.md`), commandContent);
    agentCommandCount++;
  }
  if (agentCommandCount > 0) {
    log.success(`commands/ (${agentCommandCount} agent commands generated)`);
  }

  // Generate skill commands from skills enabled for Claude
  const enabledSkills = enabledSkillsFor(skills, "claude");
  let skillCommandCount = 0;
  for (const skill of enabledSkills) {
    const fm = skill.frontmatter;
    const skillName = fm.name ?? skill.name;
    const claudePlatform = fm.platforms?.claude;

    const lines: string[] = ["---"];
    lines.push(`description: ${fm.description}`);

    if (fm.model && fm.model !== "inherit") {
      lines.push(`model: ${fm.model}`);
    }
    if (fm.effort) {
      lines.push(`effort: ${fm.effort}`);
    }
    if (fm.argumentHint) {
      lines.push(`argument-hint: ${fm.argumentHint}`);
    }
    if (!fm.userInvocable) {
      lines.push(`user-invocable: false`);
    }
    if (!fm.allowModelInvocation) {
      lines.push(`disable-model-invocation: true`);
    }
    if (fm.tools) {
      const toolList = mapTools(fm.tools as ToolPermissions, "claude", cfg);
      if (toolList.length > 0) {
        lines.push(`allowed-tools: ${toolList.join(", ")}`);
      }
    }
    if (fm.isolation === "fork") {
      lines.push(`context: fork`);
    }
    if (claudePlatform?.shell) {
      lines.push(`shell: ${claudePlatform.shell}`);
    }
    if (fm.paths) {
      const pathList = Array.isArray(fm.paths) ? fm.paths : [fm.paths];
      lines.push(`paths: ${pathList.join(", ")}`);
    }
    if (fm.hooks) {
      lines.push(`hooks:`);
      for (const [event, entries] of Object.entries(fm.hooks)) {
        if (!entries || (entries as unknown[]).length === 0) continue;
        lines.push(`  ${event}:`);
        for (const entry of entries as Array<{ matcher?: string; command: string }>) {
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
    lines.push("---");

    const commandContent = `${lines.join("\n")}\n\n${skill.body}\n`;
    writeFile(join(outDir, "commands", `${skillName}.md`), commandContent);
    skillCommandCount++;
  }
  if (skillCommandCount > 0) {
    log.success(`commands/ (${skillCommandCount} skill commands generated)`);
  }

  // Build MCP servers block
  const mcpServers: Record<string, unknown> = {};
  for (const [name, server] of mcpServersFor(mcp, "claude")) {
    if (server.type === "local") {
      const entry: Record<string, unknown> = {};
      if (server.command) entry.command = server.command;
      if (server.args) entry.args = server.args;
      const env = translateEnvMap(server.env, "claude");
      if (env) entry.env = env;
      mcpServers[name] = entry;
      log.dim(`  mcp: ${name} (local)`);
    } else if (server.url) {
      const entry: Record<string, unknown> = { url: server.url };
      const headers = translateEnvMap(server.headers, "claude");
      if (headers) entry.headers = headers;
      mcpServers[name] = entry;
      log.dim(`  mcp: ${name} (remote)`);
    }
  }

  // Build settings.json
  const enabledPlugins: Record<string, boolean> = {};
  const extraKnownMarketplaces: Record<string, unknown> = {};

  for (const plugin of plugins.claude.marketplace_plugins) {
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

  const settings: Record<string, unknown> = {
    enabledPlugins,
  };
  if (Object.keys(extraKnownMarketplaces).length > 0) {
    settings.extraKnownMarketplaces = extraKnownMarketplaces;
  }
  if (Object.keys(mcpServers).length > 0) {
    settings.mcpServers = mcpServers;
  }

  writeFile(join(outDir, "settings.json"), JSON.stringify(settings, null, 2));
  log.success("settings.json");

  // Copy raw/common files (preserve subfolder structure)
  const rawCommon = join(aiDir, "raw", "common");
  if (fileExists(rawCommon)) {
    copyDir(rawCommon, outDir);
    log.success("raw/common/");
  }
}
