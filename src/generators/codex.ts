import { join } from "node:path";

import { type ParsedAgent, enabledAgentsFor } from "../parsers/agent.js";
import { type ParsedSkill, enabledSkillsFor } from "../parsers/skill.js";
import type { McpConfig, PermissionsConfig } from "../schema.js";
import { mergeOrCopyDir } from "../utils/config-merger.js";
import { translateEnvVar } from "../utils/env-var.js";
import { cleanDir, copyDir, fileExists, writeFile } from "../utils/fs.js";
import { log } from "../utils/logger.js";
import { mcpServersFor } from "../utils/mcp-block.js";
import { buildPolicyCommentBlock } from "../utils/policy-comments.js";

const CODEX_DEFAULT_MODEL = "gpt-5.4";
const CODEX_DEFAULT_MODEL_REASONING_EFFORT = "high";
const CODEX_DEFAULT_SANDBOX = "elevated";
const CODEX_DEFAULT_MCP_STARTUP_TIMEOUT_SEC = 20;

/**
 * Parse a headers map and emit the Codex TOML representation for an HTTP MCP server.
 *
 * Codex distinguishes three cases for headers:
 * - `bearer_token_env_var`: shorthand when a header value is exactly `Bearer ${VAR}`
 * - `env_http_headers`:     table mapping header-name → env-var-name (for `${VAR}` values)
 * - `http_headers`:         table of static key-value pairs (no env var substitution)
 *
 * Returns the TOML lines to append after the `url =` line.
 */
function codexHttpHeaderLines(name: string, headers: Record<string, string> | undefined): string[] {
  if (!headers || Object.keys(headers).length === 0) return [];

  const lines: string[] = [];
  const envHeaders: Array<[string, string]> = [];
  const staticHeaders: Array<[string, string]> = [];
  let bearerVar: string | undefined;

  for (const [headerName, headerValue] of Object.entries(headers)) {
    // Detect `Bearer ${VAR}` pattern — maps to bearer_token_env_var
    const bearerMatch = headerValue.match(/^Bearer \$\{(\w+)\}$/);
    if (bearerMatch && !bearerVar) {
      bearerVar = bearerMatch[1];
      continue;
    }
    // Detect `${VAR}` pattern (possibly with prefix/suffix) — maps to env_http_headers
    if (/\$\{(\w+)\}/.test(headerValue)) {
      const varName = translateEnvVar(headerValue, "codex_header");
      envHeaders.push([headerName, varName]);
      continue;
    }
    // Static value
    staticHeaders.push([headerName, headerValue]);
  }

  if (bearerVar) {
    lines.push(`bearer_token_env_var = "${bearerVar}"`);
  }
  if (staticHeaders.length > 0) {
    const pairs = staticHeaders.map(([k, v]) => `"${k}" = "${v}"`).join(", ");
    lines.push(`http_headers = { ${pairs} }`);
  }
  if (envHeaders.length > 0) {
    const pairs = envHeaders.map(([k, v]) => `"${k}" = "${v}"`).join(", ");
    lines.push(`env_http_headers = { ${pairs} }`);
  }

  return lines;
}

export function generateCodex(
  agents: readonly ParsedAgent[],
  skills: readonly ParsedSkill[],
  mcp: McpConfig,
  aiDir: string,
  outDir: string,
  permissions: PermissionsConfig = {},
): void {
  cleanDir(outDir);
  log.header("Codex");

  const enabledAgents = enabledAgentsFor(agents, "codex");
  const enabledSkills = enabledSkillsFor(skills, "codex");
  const lines: string[] = [];

  // Top-level config
  lines.push(`model = "${CODEX_DEFAULT_MODEL}"`);
  lines.push(`model_reasoning_effort = "${CODEX_DEFAULT_MODEL_REASONING_EFFORT}"`);

  // approval_policy: permissions.json wins, fallback omitted (Codex uses its own default)
  const approvalMode = permissions?.codex?.approvalMode;
  if (approvalMode) {
    lines.push(`approval_policy = "${approvalMode}"`);
  }

  lines.push("");
  lines.push("[windows]");
  const sandbox = permissions?.codex?.sandbox ?? CODEX_DEFAULT_SANDBOX;
  lines.push(`sandbox = "${sandbox}"`);
  lines.push("");

  // Project trust levels: merge permissions.json entries over ULIS defaults
  const trustedProjects = permissions?.codex?.trustedProjects ?? {};
  for (const [path, level] of Object.entries(trustedProjects)) {
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
      lines.push(`startup_timeout_sec = ${CODEX_DEFAULT_MCP_STARTUP_TIMEOUT_SEC}`);
      if (server.env) {
        lines.push("");
        lines.push(`[mcp_servers.${name}.env]`);
        for (const [k, v] of Object.entries(server.env)) {
          lines.push(`${k} = "${translateEnvVar(v, "codex")}"`);
        }
      }
      lines.push("");
      log.dim(`  mcp: ${name} (local)`);
    } else if (server.url) {
      // Remote server with a URL — emit native Codex HTTP format
      lines.push(`[mcp_servers.${name}]`);
      lines.push(`url = "${server.url}"`);
      for (const headerLine of codexHttpHeaderLines(name, server.headers)) {
        lines.push(headerLine);
      }
      lines.push(`startup_timeout_sec = ${CODEX_DEFAULT_MCP_STARTUP_TIMEOUT_SEC}`);
      lines.push("");
      log.dim(`  mcp: ${name} (remote/http)`);
    } else if (server.localFallback) {
      // Remote server without a URL — fall back to local stdio process
      lines.push(`[mcp_servers.${name}]`);
      lines.push(`command = "${server.localFallback.command}"`);
      const args = server.localFallback.args.map((a) => `"${translateEnvVar(a, "codex")}"`).join(", ");
      lines.push(`args = [${args}]`);
      lines.push(`startup_timeout_sec = ${CODEX_DEFAULT_MCP_STARTUP_TIMEOUT_SEC}`);
      lines.push("");
      log.dim(`  mcp: ${name} (remote->localFallback)`);
    } else {
      log.warn(`  mcp: ${name} skipped (remote, no url or localFallback)`);
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

    // Model: platform-specific override only (Claude aliases like opus/sonnet/haiku don't apply to Codex)
    if (codexPlatform?.model) {
      agentLines.push(`model = "${codexPlatform.model}"`);
    }

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
    const hasModel = !!codexPlatform?.model;
    const needsYaml = hasUiConfig || hasDeps || hasModel || !fm.allowImplicitInvocation;

    if (needsYaml) {
      const yamlLines: string[] = [];

      if (hasModel) {
        yamlLines.push(`model: "${codexPlatform!.model}"`);
        yamlLines.push("");
      }

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

  // Merge raw files into output (common first, then platform-specific to allow overrides)
  const rawCommon = join(aiDir, "raw", "common");
  if (fileExists(rawCommon)) {
    mergeOrCopyDir(rawCommon, outDir);
    log.success("raw/common/");
  }
  const rawPlatform = join(aiDir, "raw", "codex");
  if (fileExists(rawPlatform)) {
    mergeOrCopyDir(rawPlatform, outDir);
    log.success("raw/codex/");
  }
}
