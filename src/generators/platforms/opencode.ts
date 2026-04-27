import { join } from "node:path";

import { enabledAgentsFor } from "../../parsers/agent.js";
import { parseCommands } from "../../parsers/command.js";
import { enabledRulesFor } from "../../parsers/rule.js";
import { enabledSkillsFor } from "../../parsers/skill.js";
import { fileExists, readFile } from "../../utils/fs.js";
import { mcpServersFor, translateEnvMap } from "../../utils/mcp-block.js";
import { buildPolicyCommentBlock } from "../../utils/policy-comments.js";
import { buildRulesIndex } from "../shared/rules-index.js";
import { serializeYamlFrontmatter } from "../shared/yaml.js";
import type { FileArtifact, GenerationResult, ProjectBundle } from "../types.js";

const OPENCODE_DEFAULT_MODEL = "anthropic/sonnet";
const OPENCODE_SMALL_MODEL = "opencode/kimi-k2.5-free";

export function generateOpencode(project: ProjectBundle): GenerationResult {
  const artifacts: FileArtifact[] = [];

  const enabledAgents = enabledAgentsFor(project.agents, "opencode");
  const enabledSkills = enabledSkillsFor(project.skills, "opencode");

  // Build agent block for opencode.json
  const agentBlock: Record<string, unknown> = {};
  for (const agent of enabledAgents) {
    const ocPlatform = agent.frontmatter.platforms?.opencode;

    // Destructure fields with special merge/derive logic; everything else passes through.
    const {
      enabled: _enabled,
      model: _model,
      mode: _mode,
      top_p: _top_p,
      rate_limit_per_hour: _rate_limit,
      permission: _permission,
      hidden: _hidden,
      disable: _disable,
      ...ocExtra
    } = (ocPlatform ?? {}) as Record<string, unknown>;

    const ocModel = ocPlatform?.model ?? agent.frontmatter.model;

    const entry: Record<string, unknown> = {
      description: agent.frontmatter.description,
      mode: ocPlatform?.mode ?? "subagent",
      model: ocModel,
      tools: agent.frontmatter.tools,
    };

    if (agent.frontmatter.temperature !== undefined) entry.temperature = agent.frontmatter.temperature;
    if (agent.frontmatter.maxTurns !== undefined) entry.steps = agent.frontmatter.maxTurns;
    if (ocPlatform?.top_p !== undefined) entry.top_p = ocPlatform.top_p;
    if (ocPlatform?.hidden) entry.hidden = true;
    if (ocPlatform?.disable) entry.disable = true;

    const sec = agent.frontmatter.security;
    const toolPolicy = agent.frontmatter.toolPolicy;
    const basePerm = ocPlatform?.permission ?? {};
    const derivedPerm: Record<string, string> = { ...basePerm };

    if (sec?.permissionLevel === "readonly") {
      derivedPerm.edit ??= "deny";
      derivedPerm.bash ??= "deny";
    }
    if (sec?.requireApproval?.includes("edit") || toolPolicy?.requireConfirmation?.includes("edit")) {
      derivedPerm.edit ??= "ask";
    }
    if (sec?.requireApproval?.includes("bash") || toolPolicy?.requireConfirmation?.includes("bash")) {
      derivedPerm.bash ??= "ask";
    }
    if (Object.keys(derivedPerm).length > 0) entry.permission = derivedPerm;

    const rateLimit = ocPlatform?.rate_limit_per_hour ?? sec?.rateLimit?.perHour;
    if (rateLimit !== undefined) entry.rate_limit_per_hour = rateLimit;

    Object.assign(entry, ocExtra);

    agentBlock[agent.name] = entry;
  }

  // MCP block
  const mcpBlock: Record<string, unknown> = {};
  for (const [name, server] of mcpServersFor(project.mcp, "opencode")) {
    if (server.type === "local") {
      const entry: Record<string, unknown> = {
        type: "local",
        enabled: server.enabled ?? true,
        command: server.command ? [server.command, ...(server.args ?? [])] : undefined,
      };
      const environment = translateEnvMap(server.env, "opencode_env");
      if (environment) entry.environment = environment;
      mcpBlock[name] = entry;
    } else {
      const entry: Record<string, unknown> = {
        type: "remote",
        enabled: server.enabled ?? true,
        url: server.url,
      };
      const headers = translateEnvMap(server.headers, "opencode_header");
      if (headers) entry.headers = headers;
      mcpBlock[name] = entry;
    }
  }

  // Permission block
  const permissionBlock: Record<string, unknown> = { ...(project.permissions?.opencode?.permission ?? {}) };

  // opencode.json
  const opencodeJson = {
    $schema: "https://opencode.ai/config.json",
    model: OPENCODE_DEFAULT_MODEL,
    small_model: OPENCODE_SMALL_MODEL,
    agent: agentBlock,
    permission: permissionBlock,
    mcp: mcpBlock,
  };
  artifacts.push({ path: "opencode.json", contents: JSON.stringify(opencodeJson, null, 2) });

  // Agent markdown bodies under agents/core or agents/specialized
  for (const agent of enabledAgents) {
    const isCore = agent.frontmatter.tags.includes("core");
    const destDir = isCore ? join("agents", "core") : join("agents", "specialized");
    const commentOnlyHints = agent.frontmatter.contextHints ? { contextHints: agent.frontmatter.contextHints } : {};
    const commentOnlySec = agent.frontmatter.security?.restrictedPaths?.length
      ? { security: { ...agent.frontmatter.security, blockedCommands: [], requireApproval: [] } }
      : {};
    const policyBlock = buildPolicyCommentBlock({ ...commentOnlyHints, ...commentOnlySec }, "md");
    const body = policyBlock ? `${policyBlock}\n${agent.body}` : agent.body;
    artifacts.push({ path: join(destDir, `${agent.name}.md`), contents: body });
  }

  // Commands with OpenCode-specific frontmatter resolution
  const commandsSrc = join(project.sourceDir, "commands");
  if (fileExists(commandsSrc)) {
    for (const cmd of parseCommands(commandsSrc)) {
      const fm = cmd.frontmatter as Record<string, unknown>;
      const ocPlatform = (fm.platforms as Record<string, unknown> | undefined)?.opencode as
        | Record<string, unknown>
        | undefined;
      const resolvedModel = (ocPlatform?.model ?? fm.model) as string | undefined;
      const resolvedAgent = (ocPlatform?.agent ?? fm.agent) as string | undefined;
      const resolvedSubtask = (ocPlatform?.subtask ?? fm.subtask) as boolean | undefined;

      const { enabled: _e, model: _ocm, agent: _oca, subtask: _ocs, ...ocExtra } = ocPlatform ?? {};
      const { platforms: _platforms, model: _model, agent: _agent, subtask: _subtask, ...rest } = fm;
      const outData: Record<string, unknown> = { ...rest, ...ocExtra };
      if (resolvedModel) outData.model = resolvedModel;
      if (resolvedAgent) outData.agent = resolvedAgent;
      if (resolvedSubtask !== undefined) outData.subtask = resolvedSubtask;

      artifacts.push({
        path: join("commands", cmd.filename),
        contents: `${serializeYamlFrontmatter(outData)}\n\n${cmd.body}\n`,
      });
    }
    const readmeSrc = join(commandsSrc, "README.md");
    if (fileExists(readmeSrc)) {
      artifacts.push({ path: join("commands", "README.md"), contents: readFile(readmeSrc) });
    }
  }

  // Empty settings.json
  artifacts.push({ path: "settings.json", contents: "{}" });

  // Rules: files + optional AGENTS.md index injection
  const unsupportedPlatformRules = project.ulisConfig.unsupportedPlatformRules ?? "inject";
  const appendAfterRaw: { path: string; content: string }[] = [];
  if (unsupportedPlatformRules === "inject") {
    const result = buildRulesIndex(enabledRulesFor(project.rules, "opencode"), {
      sourceDir: project.sourceDir,
      artifactPrefix: "rules",
      indexPath: "AGENTS.md",
    });
    if (result) {
      artifacts.push(...result.artifacts);
      appendAfterRaw.push(result.appendEntry);
    }
  }

  const docsSrc = join(project.sourceDir, "docs");
  const copyDirs = fileExists(docsSrc) ? [{ src: docsSrc, destRelative: "docs" }] : [];

  return {
    artifacts,
    post: {
      rawDirs: [join(project.sourceDir, "raw", "common"), join(project.sourceDir, "raw", "opencode")],
      aliasFiles: [],
      skillDirs: enabledSkills.map((s) => {
        const p = s.frontmatter?.platforms?.opencode;
        const { enabled: _e, model: _m, ...extra } = (p ?? {}) as Record<string, unknown>;
        const model = p?.model ?? s.frontmatter?.model;
        return { name: s.name, dir: s.dir, extraFrontmatter: { ...(model ? { model } : {}), ...extra } };
      }),
      appendAfterRaw,
      copyDirs,
    },
  };
}
