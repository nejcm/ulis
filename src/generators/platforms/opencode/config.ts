import type { ParsedAgent } from "../../../parsers/agent.js";
import { mcpServerEnabled, mcpServersFor, translateEnvMap } from "../../../utils/mcp-block.js";
import { mapOpencodeTools } from "../../../utils/tool-mapper.js";
import type { ProjectBundle } from "../../types.js";

const OPENCODE_DEFAULT_MODEL = "anthropic/sonnet";
const OPENCODE_SMALL_MODEL = "opencode/kimi-k2.5-free";

function buildAgentBlock(enabledAgents: readonly ParsedAgent[]): Record<string, unknown> {
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
      tools: mapOpencodeTools(agent.frontmatter.tools),
    };

    if (agent.frontmatter.temperature !== undefined) entry.temperature = agent.frontmatter.temperature;
    if (agent.frontmatter.maxTurns !== undefined) entry.steps = agent.frontmatter.maxTurns;
    if (ocPlatform?.top_p !== undefined) entry.top_p = ocPlatform.top_p;
    if (ocPlatform?.hidden) entry.hidden = true;
    if (ocPlatform?.disable) entry.disable = true;

    const sec = agent.frontmatter.security;
    const toolPolicy = agent.frontmatter.toolPolicy;
    const basePerm = ocPlatform?.permission ?? {};
    const derivedPerm: Record<string, unknown> = { ...basePerm };

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
    const tools = agent.frontmatter.tools;
    if (typeof tools !== "string" && Array.isArray(tools.agent)) {
      derivedPerm.task ??= Object.fromEntries([["*", "deny"], ...tools.agent.map((name) => [name, "allow"])]);
    }
    if (Object.keys(derivedPerm).length > 0) entry.permission = derivedPerm;

    const rateLimit = ocPlatform?.rate_limit_per_hour ?? sec?.rateLimit?.perHour;
    if (rateLimit !== undefined) entry.rate_limit_per_hour = rateLimit;

    Object.assign(entry, ocExtra);

    agentBlock[agent.name] = entry;
  }
  return agentBlock;
}

function buildMcpBlock(mcp: ProjectBundle["mcp"]): Record<string, unknown> {
  const mcpBlock: Record<string, unknown> = {};
  for (const [name, server] of mcpServersFor(mcp, "opencode")) {
    if (server.type === "local") {
      const entry: Record<string, unknown> = {
        type: "local",
        enabled: mcpServerEnabled(server) ?? true,
        command: server.command ? [server.command, ...(server.args ?? [])] : undefined,
      };
      const environment = translateEnvMap(server.env, "opencode_env");
      if (environment) entry.environment = environment;
      mcpBlock[name] = entry;
    } else {
      const entry: Record<string, unknown> = {
        type: "remote",
        enabled: mcpServerEnabled(server) ?? true,
        url: server.url,
      };
      const headers = translateEnvMap(server.headers, "opencode_header");
      if (headers) entry.headers = headers;
      mcpBlock[name] = entry;
    }
  }
  return mcpBlock;
}

export function buildOpencodeJson(project: ProjectBundle, enabledAgents: readonly ParsedAgent[]): string {
  const opencodeJson = {
    $schema: "https://opencode.ai/config.json",
    model: OPENCODE_DEFAULT_MODEL,
    small_model: OPENCODE_SMALL_MODEL,
    instructions: [".opencode/AGENTS.md"],
    agent: buildAgentBlock(enabledAgents),
    permission: { ...(project.permissions?.opencode?.permission ?? {}) },
    mcp: buildMcpBlock(project.mcp),
  };
  return JSON.stringify(opencodeJson, null, 2);
}
