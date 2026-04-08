import { readdirSync } from "node:fs";
import { join } from "node:path";

import type { BuildConfig } from "../config.js";
import { type ParsedAgent, enabledAgentsFor } from "../parsers/agent.js";
import { type ParsedSkill, enabledSkillsFor } from "../parsers/skill.js";
import type { McpConfig } from "../schema.js";
import { translateEnvVar } from "../utils/env-var.js";
import { writeFile, cleanDir, copyDir, fileExists, readFile } from "../utils/fs.js";
import { log } from "../utils/logger.js";
import { mcpServersFor } from "../utils/mcp-block.js";
import { buildPolicyCommentBlock } from "../utils/policy-comments.js";

export function generateCodex(
  agents: readonly ParsedAgent[],
  skills: readonly ParsedSkill[],
  mcp: McpConfig,
  aiDir: string,
  outDir: string,
  buildConfig: BuildConfig,
): void {
  cleanDir(outDir);
  log.header("Codex");

  const cfg = buildConfig.platforms.codex;
  const enabledAgents = enabledAgentsFor(agents, "codex");
  const enabledSkills = enabledSkillsFor(skills, "codex");
  const lines: string[] = [];

  // Top-level config
  lines.push(`model = "${cfg.model}"`);
  lines.push(`model_reasoning_effort = "${cfg.modelReasoningEffort}"`);
  lines.push("");
  lines.push("[windows]");
  lines.push(`sandbox = "${cfg.sandbox}"`);
  lines.push("");

  // Project trust levels
  for (const [path, level] of Object.entries(cfg.trustedProjects)) {
    lines.push(`[projects.'${path}']`);
    lines.push(`trust_level = "${level}"`);
    lines.push("");
  }

  // MCP servers (Codex only supports local; remote falls back to localFallback)
  for (const [name, server] of mcpServersFor(mcp, "codex")) {
    if (server.type === "local") {
      lines.push(`[mcp_servers.${name}]`);
      if (server.command) {
        lines.push(`command = "${server.command}"`);
      }
      if (server.args) {
        const args = server.args.map((a) => `"${translateEnvVar(a, "codex")}"`).join(", ");
        lines.push(`args = [${args}]`);
      }
      lines.push(`startup_timeout_sec = ${cfg.mcpStartupTimeoutSec}`);
      if (server.env) {
        lines.push("");
        lines.push(`[mcp_servers.${name}.env]`);
        for (const [k, v] of Object.entries(server.env)) {
          lines.push(`${k} = "${translateEnvVar(v, "codex")}"`);
        }
      }
      lines.push("");
      log.dim(`  mcp: ${name} (local)`);
    } else if (server.localFallback) {
      // Use local fallback for remote servers
      lines.push(`[mcp_servers.${name}]`);
      lines.push(`command = "${server.localFallback.command}"`);
      const args = server.localFallback.args.map((a) => `"${translateEnvVar(a, "codex")}"`).join(", ");
      lines.push(`args = [${args}]`);
      lines.push(`startup_timeout_sec = ${cfg.mcpStartupTimeoutSec}`);
      lines.push("");
      log.dim(`  mcp: ${name} (remote->localFallback)`);
    } else {
      log.warn(`  mcp: ${name} skipped (remote, no localFallback)`);
    }
  }

  writeFile(join(outDir, "config.toml"), lines.join("\n"));
  log.success("config.toml");

  // Generate per-agent TOML files in agents/
  const effortMap: Record<string, string> = {
    low: "low",
    medium: "medium",
    high: "high",
    max: "max",
  };

  for (const agent of enabledAgents) {
    const codexPlatform = agent.frontmatter.platforms?.codex;
    const agentLines: string[] = [];

    agentLines.push(`name = "${agent.name}"`);
    agentLines.push(`description = "${agent.frontmatter.description.replace(/"/g, '\\"')}"`);
    agentLines.push("");
    agentLines.push(`developer_instructions = """`);
    agentLines.push(agent.body.trim());
    agentLines.push(`"""`);
    agentLines.push("");

    // Model: Codex uses its own model names; only write if there's a codex-specific override
    // (Claude model aliases like opus/sonnet/haiku don't apply here)

    // Reasoning effort: platform override > agent effort field > global
    const reasoningEffort =
      codexPlatform?.model_reasoning_effort ??
      (agent.frontmatter.effort ? effortMap[agent.frontmatter.effort] : undefined);
    if (reasoningEffort) {
      agentLines.push(`model_reasoning_effort = "${reasoningEffort}"`);
    }

    // Sandbox mode
    if (codexPlatform?.sandbox_mode) {
      agentLines.push(`sandbox_mode = "${codexPlatform.sandbox_mode}"`);
    }

    // Nickname candidates
    if (codexPlatform?.nickname_candidates?.length) {
      const nicks = codexPlatform.nickname_candidates.map((n) => `"${n}"`).join(", ");
      agentLines.push(`nickname_candidates = [${nicks}]`);
    }

    // All policy fields (contextHints, toolPolicy, security) → TOML comments at top
    const policyBlock = buildPolicyCommentBlock(agent.frontmatter, "toml");
    const tomlContent = policyBlock ? `${policyBlock}\n${agentLines.join("\n")}` : agentLines.join("\n");
    writeFile(join(outDir, "agents", `${agent.name}.toml`), tomlContent);
    log.dim(`  agent: ${agent.name}`);
  }
  log.success("agents/ (per-agent TOML files)");

  // Generate skill files
  for (const skill of enabledSkills) {
    const skillName = skill.frontmatter.name ?? skill.name;
    const fm = skill.frontmatter;
    const codexPlatform = fm.platforms?.codex;

    // Write SKILL.md (body only, no frontmatter — Codex reads name/description from agents/openai.yaml)
    writeFile(join(outDir, "skills", skill.name, "SKILL.md"), skill.body + "\n");

    // Generate agents/openai.yaml if there's codex-specific config
    const hasUiConfig =
      codexPlatform?.displayName ||
      codexPlatform?.shortDescription ||
      codexPlatform?.iconSmall ||
      codexPlatform?.iconLarge ||
      codexPlatform?.brandColor ||
      codexPlatform?.defaultPrompt;
    const hasDeps = codexPlatform?.mcpDependencies?.length;
    const needsYaml = hasUiConfig || hasDeps || !fm.allowImplicitInvocation;

    if (needsYaml) {
      const yamlLines: string[] = [];

      if (hasUiConfig) {
        yamlLines.push("interface:");
        yamlLines.push(`  display_name: "${codexPlatform?.displayName ?? skillName}"`);
        if (codexPlatform?.shortDescription) {
          yamlLines.push(`  short_description: "${codexPlatform.shortDescription}"`);
        }
        if (codexPlatform?.iconSmall) {
          yamlLines.push(`  icon_small: "${codexPlatform.iconSmall}"`);
        }
        if (codexPlatform?.iconLarge) {
          yamlLines.push(`  icon_large: "${codexPlatform.iconLarge}"`);
        }
        if (codexPlatform?.brandColor) {
          yamlLines.push(`  brand_color: "${codexPlatform.brandColor}"`);
        }
        if (codexPlatform?.defaultPrompt) {
          yamlLines.push(`  default_prompt: "${codexPlatform.defaultPrompt}"`);
        }
        yamlLines.push("");
      }

      yamlLines.push("policy:");
      yamlLines.push(`  allow_implicit_invocation: ${fm.allowImplicitInvocation}`);
      yamlLines.push("");

      if (hasDeps) {
        yamlLines.push("dependencies:");
        yamlLines.push("  tools:");
        for (const dep of codexPlatform!.mcpDependencies!) {
          yamlLines.push(`    - type: ${dep.type}`);
          yamlLines.push(`      value: "${dep.value}"`);
          if (dep.description) yamlLines.push(`      description: "${dep.description}"`);
          if (dep.transport) yamlLines.push(`      transport: "${dep.transport}"`);
          if (dep.url) yamlLines.push(`      url: "${dep.url}"`);
        }
      }

      writeFile(join(outDir, "skills", skill.name, "agents", "openai.yaml"), yamlLines.join("\n") + "\n");
    }

    log.dim(`  skill: ${skill.name}`);
  }
  if (enabledSkills.length > 0) {
    log.success(`skills/ (${enabledSkills.length} skills)`);
  }

  // Generate AGENTS.md with agent instructions
  const agentsSections: string[] = [];

  // Agent orchestration table (reuse enabledAgents computed earlier)

  agentsSections.push("# Agent Instructions");
  agentsSections.push("");
  agentsSections.push("## Available Agents");
  agentsSections.push("");
  agentsSections.push("| Agent | Purpose | Model |");
  agentsSections.push("|-------|---------|-------|");
  for (const agent of enabledAgents) {
    agentsSections.push(`| ${agent.name} | ${agent.frontmatter.description} | ${agent.frontmatter.model} |`);
  }
  agentsSections.push("");

  if (enabledSkills.length > 0) {
    agentsSections.push("## Available Skills");
    agentsSections.push("");
    agentsSections.push("| Skill | Description | Category |");
    agentsSections.push("|-------|-------------|----------|");
    for (const skill of enabledSkills) {
      const category = skill.frontmatter.category ?? "-";
      agentsSections.push(`| $${skill.name} | ${skill.frontmatter.description} | ${category} |`);
    }
    agentsSections.push("");
  }

  // Individual agent instructions
  for (const agent of enabledAgents) {
    agentsSections.push(`---`);
    agentsSections.push("");
    agentsSections.push(agent.body);
    agentsSections.push("");
  }

  // Append guardrails
  const guardrailsSrc = join(aiDir, "guardrails.md");
  if (fileExists(guardrailsSrc)) {
    agentsSections.push("---");
    agentsSections.push("");
    agentsSections.push(readFile(guardrailsSrc));
    agentsSections.push("");
  }

  // Append workflows
  const workflowsDir = join(aiDir, "workflows");
  if (fileExists(workflowsDir)) {
    const workflowFiles = readdirSync(workflowsDir).filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md");
    for (const file of workflowFiles) {
      agentsSections.push("---");
      agentsSections.push("");
      agentsSections.push(readFile(join(workflowsDir, file)));
      agentsSections.push("");
    }
    log.success(`AGENTS.md (${workflowFiles.length} workflows included)`);
  }

  writeFile(join(outDir, "AGENTS.md"), agentsSections.join("\n"));
  log.success(`AGENTS.md (${enabledAgents.length} agents)`);

  // Copy raw/common files (preserve subfolder structure)
  const rawCommon = join(aiDir, "raw", "common");
  if (fileExists(rawCommon)) {
    copyDir(rawCommon, outDir);
    log.success("raw/common/");
  }
}
