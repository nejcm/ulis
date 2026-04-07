import { join } from "node:path";
import type { ParsedAgent } from "../parsers/agent.js";
import type { ParsedSkill } from "../parsers/skill.js";
import type { McpConfig } from "../schema.js";
import type { PluginsConfig } from "../schema.js";
import { BUILD_CONFIG } from "../config.js";
import { writeFile, copyDir, cleanDir, fileExists } from "../utils/fs.js";
import { translateEnvVar } from "../utils/env-var.js";
import { readFile } from "../utils/fs.js";
import { log } from "../utils/logger.js";
import { buildPolicyCommentBlock } from "../utils/policy-comments.js";

export function generateOpencode(
  agents: readonly ParsedAgent[],
  skills: readonly ParsedSkill[],
  mcp: McpConfig,
  plugins: PluginsConfig,
  aiDir: string,
  outDir: string,
): void {
  cleanDir(outDir);
  log.header("OpenCode");

  const config = BUILD_CONFIG.opencode;

  // Build agent block
  const agentBlock: Record<string, unknown> = {};
  for (const agent of agents) {
    if (agent.frontmatter.platforms?.opencode?.enabled === false) continue;

    const ocName = config.agentNameMap[agent.name] ?? agent.name;
    const ocModel = config.modelMap[agent.frontmatter.model] ?? agent.frontmatter.model;
    const ocPlatform = agent.frontmatter.platforms?.opencode;

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
  for (const [name, server] of Object.entries(mcp.servers)) {
    if (!server.targets.includes("opencode")) continue;

    if (server.type === "local") {
      const entry: Record<string, unknown> = {
        type: "local",
        enabled: true,
        command: server.command ? [server.command, ...(server.args ?? [])] : undefined,
      };
      if (server.env) {
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(server.env)) {
          env[k] = translateEnvVar(v, "opencode_env");
        }
        entry.environment = env;
      }
      mcpBlock[name] = entry;
    } else {
      const entry: Record<string, unknown> = {
        type: "remote",
        url: server.url,
      };
      if (server.headers) {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(server.headers)) {
          headers[k] = translateEnvVar(v, "opencode_header");
        }
        entry.headers = headers;
      }
      mcpBlock[name] = entry;
    }
    log.dim(`  mcp: ${name} (${server.type})`);
  }

  // Build permission block (from guardrails - static for now)
  const permissionBlock = {
    skill: { "*": "ask", "read-*": "allow", "search-*": "allow", "internal-*": "deny" },
    bash: {
      "*": "ask",
      "bq query*": "allow",
      "bun run build:*": "allow",
      "bun run lint:file:*": "allow",
      "bun run test:*": "allow",
      "bun run test:file:*": "allow",
      "bun run typecheck:*": "allow",
      "bun test:*": "allow",
      "cc:*": "allow",
      "comm:*": "allow",
      "find*": "allow",
    },
    tool: { bash: "ask", write: "ask", edit: "ask", read: "allow" },
    read: { "C:/Work/Personal/dotfiles/.opencode/get-shit-done/*": "allow" },
    external_directory: { "C:/Work/Personal/dotfiles/.opencode/get-shit-done/*": "allow" },
  };

  // Assemble opencode.json
  const opencodeJson = {
    $schema: config.schema,
    model: config.defaultModel,
    small_model: config.smallModel,
    plugin: plugins.opencode.plugins,
    agent: agentBlock,
    permission: permissionBlock,
    mcp: mcpBlock,
  };

  writeFile(join(outDir, "opencode.json"), JSON.stringify(opencodeJson, null, 2));
  log.success("opencode.json");

  // Copy agent markdown bodies, prepending policy comment block for non-native fields
  const agentsCoreDir = join(outDir, "agents", "core");
  const agentsSpecDir = join(outDir, "agents", "specialized");
  for (const agent of agents) {
    if (agent.frontmatter.platforms?.opencode?.enabled === false) continue;
    const ocName = config.agentNameMap[agent.name] ?? agent.name;
    const isCore = agent.frontmatter.tags.includes("core");
    const destDir = isCore ? agentsCoreDir : agentsSpecDir;
    // contextHints and restrictedPaths have no native OpenCode equivalent → comments in body
    const commentOnlyHints = agent.frontmatter.contextHints
      ? { contextHints: agent.frontmatter.contextHints }
      : {};
    const commentOnlySec = agent.frontmatter.security?.restrictedPaths?.length
      ? { security: { ...agent.frontmatter.security, blockedCommands: [], requireApproval: [] } }
      : {};
    const policyBlock = buildPolicyCommentBlock(
      { ...commentOnlyHints, ...commentOnlySec },
      "md",
    );
    const body = policyBlock ? `${policyBlock}\n${agent.body}` : agent.body;
    writeFile(join(destDir, `${ocName}.md`), body);
  }
  log.success("agents/");

  // Copy skill directories filtered by OpenCode platform enablement
  const enabledSkills = skills.filter((s) => s.frontmatter.platforms?.opencode?.enabled !== false);
  let skillCount = 0;
  for (const skill of enabledSkills) {
    copyDir(skill.dir, join(outDir, "skills", skill.name));
    skillCount++;
  }
  if (skillCount > 0) {
    log.success(`skills/ (${skillCount} skills)`);
  }

  // Copy directories if they exist
  const copyDirs = ["commands", "workflows", "scripts", "plugins", "docs"];
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

  // Copy AGENTS.md and README.md if they exist in .opencode
  const agentsMdSrc = join(aiDir, "..", ".opencode", "AGENTS.md");
  if (fileExists(agentsMdSrc)) {
    writeFile(join(outDir, "AGENTS.md"), readFile(agentsMdSrc));
    log.success("AGENTS.md");
  }
  const readmeSrc = join(aiDir, "..", ".opencode", "README.md");
  if (fileExists(readmeSrc)) {
    writeFile(join(outDir, "README.md"), readFile(readmeSrc));
    log.success("README.md");
  }

  // Empty settings.json
  writeFile(join(outDir, "settings.json"), "{}");
}
