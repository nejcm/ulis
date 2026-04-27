import { join } from "node:path";

import { enabledAgentsFor } from "../../parsers/agent.js";
import { enabledRulesFor } from "../../parsers/rule.js";
import { enabledSkillsFor } from "../../parsers/skill.js";
import { translateEnvVar } from "../../utils/env-var.js";
import { fileExists, readFile } from "../../utils/fs.js";
import { mcpServersFor } from "../../utils/mcp-block.js";
import { buildPolicyCommentBlock } from "../../utils/policy-comments.js";
import { toPlatformSkillMarkdown } from "../../utils/skill-frontmatter.js";
import { buildRulesIndex } from "../shared/rules-index.js";
import { extraToYamlLines } from "../shared/yaml.js";
import type { FileArtifact, GenerationResult, ProjectBundle } from "../types.js";

const CODEX_DEFAULT_MODEL = "gpt-5.4";
const CODEX_DEFAULT_MODEL_REASONING_EFFORT = "high";
const CODEX_DEFAULT_SANDBOX = "elevated";
const CODEX_DEFAULT_MCP_STARTUP_TIMEOUT_SEC = 20;

const EFFORT_MAP: Record<string, string> = { low: "low", medium: "medium", high: "high", max: "max" };

function toTomlString(value: string): string {
  return JSON.stringify(value);
}

function toYamlString(value: string): string {
  return JSON.stringify(value);
}

function emitTomlExtra(lines: string[], extra: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      lines.push(`${key} = ${toTomlString(value)}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      lines.push(`${key} = ${value}`);
    } else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      const items = (value as string[]).map((v) => toTomlString(v)).join(", ");
      lines.push(`${key} = [${items}]`);
    }
  }
}

/**
 * Codex distinguishes three HTTP header cases:
 * - `bearer_token_env_var`: header value is exactly `Bearer ${VAR}`
 * - `env_http_headers`:     table mapping header-name → env-var-name (for `${VAR}` values)
 * - `http_headers`:         table of static key-value pairs
 */
function codexHttpHeaderLines(headers: Record<string, string> | undefined): string[] {
  if (!headers || Object.keys(headers).length === 0) return [];

  const lines: string[] = [];
  const envHeaders: Array<[string, string]> = [];
  const staticHeaders: Array<[string, string]> = [];
  let bearerVar: string | undefined;

  for (const [headerName, headerValue] of Object.entries(headers)) {
    const bearerMatch = headerValue.match(/^Bearer \$\{(\w+)\}$/);
    if (bearerMatch && !bearerVar) {
      bearerVar = bearerMatch[1];
      continue;
    }
    if (/\$\{(\w+)\}/.test(headerValue)) {
      envHeaders.push([headerName, translateEnvVar(headerValue, "codex_header")]);
      continue;
    }
    staticHeaders.push([headerName, headerValue]);
  }

  if (bearerVar) lines.push(`bearer_token_env_var = ${toTomlString(bearerVar)}`);
  if (staticHeaders.length > 0) {
    const pairs = staticHeaders.map(([k, v]) => `${toTomlString(k)} = ${toTomlString(v)}`).join(", ");
    lines.push(`http_headers = { ${pairs} }`);
  }
  if (envHeaders.length > 0) {
    const pairs = envHeaders.map(([k, v]) => `${toTomlString(k)} = ${toTomlString(v)}`).join(", ");
    lines.push(`env_http_headers = { ${pairs} }`);
  }

  return lines;
}

function buildConfigToml(project: ProjectBundle): string {
  const lines: string[] = [];
  lines.push(`model = ${toTomlString(CODEX_DEFAULT_MODEL)}`);
  lines.push(`model_reasoning_effort = ${toTomlString(CODEX_DEFAULT_MODEL_REASONING_EFFORT)}`);

  const approvalMode = project.permissions?.codex?.approvalMode;
  if (approvalMode) lines.push(`approval_policy = ${toTomlString(approvalMode)}`);

  lines.push("");
  lines.push("[windows]");
  const sandbox = project.permissions?.codex?.sandbox ?? CODEX_DEFAULT_SANDBOX;
  lines.push(`sandbox = ${toTomlString(sandbox)}`);
  lines.push("");

  const trustedProjects = project.permissions?.codex?.trustedProjects ?? {};
  for (const [path, level] of Object.entries(trustedProjects)) {
    lines.push(`[projects.'${path}']`);
    lines.push(`trust_level = ${toTomlString(level)}`);
    lines.push("");
  }

  for (const [name, server] of mcpServersFor(project.mcp, "codex")) {
    if (server.type === "local") {
      lines.push(`[mcp_servers.${name}]`);
      if (server.command) lines.push(`command = ${toTomlString(server.command)}`);
      if (server.args) {
        const args = server.args.map((a) => toTomlString(translateEnvVar(a, "codex"))).join(", ");
        lines.push(`args = [${args}]`);
      }
      lines.push(`startup_timeout_sec = ${CODEX_DEFAULT_MCP_STARTUP_TIMEOUT_SEC}`);
      if (server.env) {
        lines.push("");
        lines.push(`[mcp_servers.${name}.env]`);
        for (const [k, v] of Object.entries(server.env)) {
          lines.push(`${k} = ${toTomlString(translateEnvVar(v, "codex"))}`);
        }
      }
      lines.push("");
    } else if (server.url) {
      lines.push(`[mcp_servers.${name}]`);
      lines.push(`url = ${toTomlString(server.url)}`);
      for (const headerLine of codexHttpHeaderLines(server.headers)) lines.push(headerLine);
      lines.push(`startup_timeout_sec = ${CODEX_DEFAULT_MCP_STARTUP_TIMEOUT_SEC}`);
      lines.push("");
    } else if (server.localFallback) {
      lines.push(`[mcp_servers.${name}]`);
      lines.push(`command = ${toTomlString(server.localFallback.command)}`);
      const args = server.localFallback.args.map((a) => toTomlString(translateEnvVar(a, "codex"))).join(", ");
      lines.push(`args = [${args}]`);
      lines.push(`startup_timeout_sec = ${CODEX_DEFAULT_MCP_STARTUP_TIMEOUT_SEC}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function generateCodex(project: ProjectBundle): GenerationResult {
  const artifacts: FileArtifact[] = [];

  artifacts.push({ path: "config.toml", contents: buildConfigToml(project) });

  // Per-agent TOML files
  for (const agent of enabledAgentsFor(project.agents, "codex")) {
    const codexPlatform = agent.frontmatter.platforms?.codex;

    // Destructure fields with special merge/derive logic; everything else passes through.
    const {
      enabled: _enabled,
      model: _model,
      model_reasoning_effort: _mre,
      sandbox_mode: _sandbox,
      nickname_candidates: _nicks,
      mcp_servers: _mcp,
      ...codexExtra
    } = (codexPlatform ?? {}) as Record<string, unknown>;

    const agentLines: string[] = [];

    agentLines.push(`name = ${toTomlString(agent.name)}`);
    agentLines.push(`description = ${toTomlString(agent.frontmatter.description)}`);
    agentLines.push("");
    agentLines.push(`developer_instructions = """`);
    agentLines.push(agent.body.trim());
    agentLines.push(`"""`);
    agentLines.push("");

    if (codexPlatform?.model) agentLines.push(`model = ${toTomlString(codexPlatform.model)}`);

    const reasoningEffort =
      codexPlatform?.model_reasoning_effort ??
      (agent.frontmatter.effort ? EFFORT_MAP[agent.frontmatter.effort] : undefined);
    if (reasoningEffort) agentLines.push(`model_reasoning_effort = ${toTomlString(reasoningEffort)}`);

    if (codexPlatform?.sandbox_mode) agentLines.push(`sandbox_mode = ${toTomlString(codexPlatform.sandbox_mode)}`);

    if (codexPlatform?.nickname_candidates?.length) {
      const nicks = codexPlatform.nickname_candidates.map((n) => toTomlString(n)).join(", ");
      agentLines.push(`nickname_candidates = [${nicks}]`);
    }

    emitTomlExtra(agentLines, codexExtra);

    const policyBlock = buildPolicyCommentBlock(agent.frontmatter, "toml");
    const contents = policyBlock ? `${policyBlock}\n${agentLines.join("\n")}` : agentLines.join("\n");
    artifacts.push({ path: join("agents", `${agent.name}.toml`), contents });
  }

  // Skills: SKILL.md (transformed) + optional agents/openai.yaml per skill
  for (const skill of enabledSkillsFor(project.skills, "codex")) {
    const skillName = skill.frontmatter.name ?? skill.name;
    const fm = skill.frontmatter;
    const codexPlatform = fm.platforms?.codex;

    // Destructure known/specially-handled fields; everything else passes through.
    const {
      enabled: _enabled,
      model: _model,
      displayName: _displayName,
      shortDescription: _shortDescription,
      iconSmall: _iconSmall,
      iconLarge: _iconLarge,
      brandColor: _brandColor,
      defaultPrompt: _defaultPrompt,
      mcpDependencies: _mcpDependencies,
      ...codexSkillExtra
    } = (codexPlatform ?? {}) as Record<string, unknown>;

    const skillMdPath = join(skill.dir, "SKILL.md");
    if (!fileExists(skillMdPath)) {
      continue;
    }
    const rawSkillMd = readFile(skillMdPath);
    artifacts.push({
      path: join("skills", skill.name, "SKILL.md"),
      contents: toPlatformSkillMarkdown(rawSkillMd) + "\n",
    });

    const hasUiConfig =
      codexPlatform?.displayName ||
      codexPlatform?.shortDescription ||
      codexPlatform?.iconSmall ||
      codexPlatform?.iconLarge ||
      codexPlatform?.brandColor ||
      codexPlatform?.defaultPrompt;
    const hasDeps = codexPlatform?.mcpDependencies?.length;
    const hasModel = !!codexPlatform?.model;
    const hasExtra = Object.keys(codexSkillExtra).length > 0;
    const needsYaml = hasUiConfig || hasDeps || hasModel || hasExtra || !fm.allowImplicitInvocation;

    if (needsYaml) {
      const yamlLines: string[] = [];

      if (codexPlatform?.model) {
        yamlLines.push(`model: ${toYamlString(codexPlatform.model)}`);
        yamlLines.push("");
      }

      if (hasUiConfig) {
        yamlLines.push("interface:");
        yamlLines.push(`  display_name: ${toYamlString(codexPlatform?.displayName ?? skillName)}`);
        if (codexPlatform?.shortDescription)
          yamlLines.push(`  short_description: ${toYamlString(codexPlatform.shortDescription)}`);
        if (codexPlatform?.iconSmall) yamlLines.push(`  icon_small: ${toYamlString(codexPlatform.iconSmall)}`);
        if (codexPlatform?.iconLarge) yamlLines.push(`  icon_large: ${toYamlString(codexPlatform.iconLarge)}`);
        if (codexPlatform?.brandColor) yamlLines.push(`  brand_color: ${toYamlString(codexPlatform.brandColor)}`);
        if (codexPlatform?.defaultPrompt) {
          yamlLines.push(`  default_prompt: ${toYamlString(codexPlatform.defaultPrompt)}`);
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
          yamlLines.push(`      value: ${toYamlString(dep.value)}`);
          if (dep.description) yamlLines.push(`      description: ${toYamlString(dep.description)}`);
          if (dep.transport) yamlLines.push(`      transport: ${toYamlString(dep.transport)}`);
          if (dep.url) yamlLines.push(`      url: ${toYamlString(dep.url)}`);
        }
      }

      yamlLines.push(...extraToYamlLines(codexSkillExtra));

      artifacts.push({
        path: join("skills", skill.name, "agents", "openai.yaml"),
        contents: yamlLines.join("\n") + "\n",
      });
    }
  }

  // Rules: files + AGENTS.md index injection
  const unsupportedPlatformRules = project.ulisConfig.unsupportedPlatformRules ?? "inject";
  const appendAfterRaw: { path: string; content: string }[] = [];
  if (unsupportedPlatformRules === "inject") {
    const result = buildRulesIndex(enabledRulesFor(project.rules, "codex"), {
      sourceDir: project.sourceDir,
      artifactPrefix: "rules",
      indexPath: "AGENTS.md",
    });
    if (result) {
      artifacts.push(...result.artifacts);
      appendAfterRaw.push(result.appendEntry);
    }
  }

  return {
    artifacts,
    post: {
      rawDirs: [join(project.sourceDir, "raw", "common"), join(project.sourceDir, "raw", "codex")],
      aliasFiles: [],
      skillDirs: [],
      appendAfterRaw,
    },
  };
}
