import { join } from "node:path";

import type { BuildConfig } from "../config.js";
import { type ParsedAgent, enabledAgentsFor } from "../parsers/agent.js";
import { parseCommands } from "../parsers/command.js";
import { type ParsedSkill, enabledSkillsFor } from "../parsers/skill.js";
import type { McpConfig } from "../schema.js";
import { cleanDir, copyDir, copySkillDirs, fileExists, readFile, writeFile } from "../utils/fs.js";
import { log } from "../utils/logger.js";
import { mcpServersFor, translateEnvMap } from "../utils/mcp-block.js";
import { buildPolicyCommentBlock } from "../utils/policy-comments.js";

export function generateOpencode(
  agents: readonly ParsedAgent[],
  skills: readonly ParsedSkill[],
  mcp: McpConfig,
  aiDir: string,
  outDir: string,
  buildConfig: BuildConfig,
): void {
  cleanDir(outDir);
  log.header("OpenCode");

  const config = buildConfig.platforms.opencode;
  const enabledAgents = enabledAgentsFor(agents, "opencode");
  const enabledSkills = enabledSkillsFor(skills, "opencode");

  // Build agent block
  const agentBlock: Record<string, unknown> = {};
  for (const agent of enabledAgents) {
    const ocName = config.agentNameMap[agent.name] ?? agent.name;
    const ocPlatform = agent.frontmatter.platforms?.opencode;
    const ocModel = ocPlatform?.model ?? agent.frontmatter.model;

    const entry: Record<string, unknown> = {
      description: agent.frontmatter.description,
      mode: ocPlatform?.mode ?? "subagent",
      model: ocModel,
      tools: { ...agent.frontmatter.tools },
    };

    if (agent.frontmatter.temperature !== undefined) {
      entry.temperature = agent.frontmatter.temperature;
    }
    // steps = maxTurns for OpenCode
    if (agent.frontmatter.maxTurns !== undefined) {
      entry.steps = agent.frontmatter.maxTurns;
    }
    if (ocPlatform?.top_p !== undefined) {
      entry.top_p = ocPlatform.top_p;
    }
    if (ocPlatform?.hidden) {
      entry.hidden = true;
    }
    if (ocPlatform?.disable) {
      entry.disable = true;
    }

    // Derive permission from security + toolPolicy (security wins over platform override)
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
    if (Object.keys(derivedPerm).length > 0) {
      entry.permission = derivedPerm;
    }

    // rate_limit_per_hour: platform override or security.rateLimit
    const rateLimit = ocPlatform?.rate_limit_per_hour ?? sec?.rateLimit?.perHour;
    if (rateLimit !== undefined) {
      entry.rate_limit_per_hour = rateLimit;
    }

    agentBlock[ocName] = entry;
    log.dim(`  agent: ${ocName} (${ocModel})`);
  }

  // Build MCP block
  const mcpBlock: Record<string, unknown> = {};
  for (const [name, server] of mcpServersFor(mcp, "opencode")) {
    if (server.type === "local") {
      const entry: Record<string, unknown> = {
        type: "local",
        enabled: true,
        command: server.command ? [server.command, ...(server.args ?? [])] : undefined,
      };
      const environment = translateEnvMap(server.env, "opencode_env");
      if (environment) entry.environment = environment;
      mcpBlock[name] = entry;
    } else {
      const entry: Record<string, unknown> = {
        type: "remote",
        url: server.url,
      };
      const headers = translateEnvMap(server.headers, "opencode_header");
      if (headers) entry.headers = headers;
      mcpBlock[name] = entry;
    }
    log.dim(`  mcp: ${name} (${server.type})`);
  }

  // Build permission block from BUILD_CONFIG (overridable via .ai/global/build.config.json)
  const permissionBlock: Record<string, unknown> = {
    skill: config.skillAllowlist,
    bash: config.bashAllowlist,
    tool: config.toolPermissions,
  };
  if (Object.keys(config.readAllowlist).length > 0) {
    permissionBlock.read = config.readAllowlist;
  }
  if (Object.keys(config.externalDirectoryAllowlist).length > 0) {
    permissionBlock.external_directory = config.externalDirectoryAllowlist;
  }

  // Assemble opencode.json
  const opencodeJson = {
    $schema: config.schema,
    model: config.defaultModel,
    small_model: config.smallModel,
    agent: agentBlock,
    permission: permissionBlock,
    mcp: mcpBlock,
  };

  writeFile(join(outDir, "opencode.json"), JSON.stringify(opencodeJson, null, 2));
  log.success("opencode.json");

  // Copy agent markdown bodies, prepending policy comment block for non-native fields
  const agentsCoreDir = join(outDir, "agents", "core");
  const agentsSpecDir = join(outDir, "agents", "specialized");
  for (const agent of enabledAgents) {
    const ocName = config.agentNameMap[agent.name] ?? agent.name;
    const isCore = agent.frontmatter.tags.includes("core");
    const destDir = isCore ? agentsCoreDir : agentsSpecDir;
    // contextHints and restrictedPaths have no native OpenCode equivalent → comments in body
    const commentOnlyHints = agent.frontmatter.contextHints ? { contextHints: agent.frontmatter.contextHints } : {};
    const commentOnlySec = agent.frontmatter.security?.restrictedPaths?.length
      ? { security: { ...agent.frontmatter.security, blockedCommands: [], requireApproval: [] } }
      : {};
    const policyBlock = buildPolicyCommentBlock({ ...commentOnlyHints, ...commentOnlySec }, "md");
    const body = policyBlock ? `${policyBlock}\n${agent.body}` : agent.body;
    writeFile(join(destDir, `${ocName}.md`), body);
  }
  log.success("agents/");

  // Copy skill directories filtered by OpenCode platform enablement
  copySkillDirs(enabledSkills, join(outDir, "skills"));
  if (enabledSkills.length > 0) {
    log.success(`skills/ (${enabledSkills.length} skills)`);
  }

  // Process commands: resolve platforms.opencode.model ?? model, strip platforms block.
  const commandsSrc = join(aiDir, "commands");
  if (fileExists(commandsSrc)) {
    const parsedCmds = parseCommands(commandsSrc);
    for (const cmd of parsedCmds) {
      const fm = cmd.frontmatter as Record<string, unknown>;
      const ocPlatform = (fm.platforms as Record<string, unknown> | undefined)?.opencode as
        | Record<string, unknown>
        | undefined;
      const resolvedModel = (ocPlatform?.model ?? fm.model) as string | undefined;
      const resolvedAgent = (ocPlatform?.agent ?? fm.agent) as string | undefined;
      const resolvedSubtask = (ocPlatform?.subtask ?? fm.subtask) as boolean | undefined;

      const { platforms: _platforms, model: _model, agent: _agent, subtask: _subtask, ...rest } = fm;
      const outData: Record<string, unknown> = { ...rest };
      if (resolvedModel) outData.model = resolvedModel;
      if (resolvedAgent) outData.agent = resolvedAgent;
      if (resolvedSubtask !== undefined) outData.subtask = resolvedSubtask;

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
    const readmeSrc = join(commandsSrc, "README.md");
    if (fileExists(readmeSrc)) {
      writeFile(join(outDir, "commands", "README.md"), readFile(readmeSrc));
    }
    log.success(`commands/ (${parsedCmds.length} commands processed)`);
  }

  // Copy directories if they exist
  const copyDirs = ["workflows", "docs"];
  for (const dir of copyDirs) {
    const src = join(aiDir, dir);
    if (fileExists(src)) {
      copyDir(src, join(outDir, dir));
      log.success(`${dir}/`);
    }
  }

  // Copy guardrails
  const guardrailsSrc = join(aiDir, "guardrails.md");
  if (fileExists(guardrailsSrc)) {
    writeFile(join(outDir, "config", "guardrails.md"), readFile(guardrailsSrc));
    log.success("config/guardrails.md");
  }

  // Empty settings.json
  writeFile(join(outDir, "settings.json"), "{}");

  // Copy raw files (common first, then platform-specific to allow overrides)
  const rawCommon = join(aiDir, "raw", "common");
  if (fileExists(rawCommon)) {
    copyDir(rawCommon, outDir);
    log.success("raw/common/");
  }
  const rawPlatform = join(aiDir, "raw", "opencode");
  if (fileExists(rawPlatform)) {
    copyDir(rawPlatform, outDir);
    log.success("raw/opencode/");
  }
}
