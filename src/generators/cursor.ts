import { join } from "node:path";

import { type ParsedAgent, enabledAgentsFor } from "../parsers/agent.js";
import { type ParsedSkill, enabledSkillsFor } from "../parsers/skill.js";
import type { McpConfig, PermissionsConfig } from "../schema.js";
import { mergeOrCopyDir } from "../utils/config-merger.js";
import { cleanDir, copyDir, copySkillDirs, fileExists, writeFile } from "../utils/fs.js";
import { log } from "../utils/logger.js";
import { mcpServersFor, translateEnvMap } from "../utils/mcp-block.js";
import { buildPolicyCommentBlock } from "../utils/policy-comments.js";
import { mapTools } from "../utils/tool-mapper.js";

export function generateCursor(
  agents: readonly ParsedAgent[],
  skills: readonly ParsedSkill[],
  mcp: McpConfig,
  aiDir: string,
  outDir: string,
  permissions: PermissionsConfig = {},
): void {
  cleanDir(outDir);
  log.header("Cursor");

  // Generate agent .mdc files
  const enabledAgents = enabledAgentsFor(agents, "cursor");

  for (const agent of enabledAgents) {
    const { frontmatter: fm } = agent;
    const cursorPlatform = fm.platforms?.cursor;
    const model = cursorPlatform?.model ?? fm.model;
    const tools = mapTools(fm.tools, "cursor");

    // Resolve readonly: explicit cursor override > security.permissionLevel === "readonly"
    const isReadonly = cursorPlatform?.readonly ?? fm.security?.permissionLevel === "readonly";
    // Resolve is_background: explicit cursor override > top-level background field
    const isBackground = cursorPlatform?.is_background ?? fm.background ?? false;

    const frontmatterLines = ["---"];
    frontmatterLines.push(`description: ${fm.description}`);
    if (model) {
      frontmatterLines.push(`model: ${model}`);
    }
    if (isReadonly) {
      frontmatterLines.push(`readonly: true`);
    }
    if (isBackground) {
      frontmatterLines.push(`is_background: true`);
    }
    if (tools.length > 0) {
      frontmatterLines.push(`tools:`);
      for (const tool of tools) {
        frontmatterLines.push(`  - ${tool}`);
      }
    }
    frontmatterLines.push("---");

    // All policy fields → MDC comments (no native Cursor support)
    const policyBlock = buildPolicyCommentBlock(agent.frontmatter, "mdc");
    const bodyWithPolicy = policyBlock ? `${policyBlock}\n${agent.body.trim()}` : agent.body.trim();
    const content = `${frontmatterLines.join("\n")}\n\n${bodyWithPolicy}\n`;
    writeFile(join(outDir, "agents", `${agent.name}.mdc`), content);
    log.dim(`  agent: ${agent.name}`);
  }
  if (enabledAgents.length > 0) {
    log.success(`agents/ (${enabledAgents.length} agents generated)`);
  }

  // Copy skill directories for Cursor (follows Agent Skills open standard — same format as OpenCode)
  const enabledSkills = enabledSkillsFor(skills, "cursor");
  copySkillDirs(enabledSkills, join(outDir, "skills"));
  if (enabledSkills.length > 0) {
    log.success(`skills/ (${enabledSkills.length} skills)`);
  }

  // Generate mcp.json
  const mcpServers: Record<string, unknown> = {};

  for (const [name, server] of mcpServersFor(mcp, "cursor")) {
    if (server.type === "remote" && server.url) {
      const entry: Record<string, unknown> = { url: server.url };
      const headers = translateEnvMap(server.headers, "cursor");
      if (headers) entry.headers = headers;
      mcpServers[name] = entry;
      log.dim(`  mcp: ${name} (remote)`);
    } else if (server.type === "local") {
      const entry: Record<string, unknown> = {};
      if (server.command) entry.command = server.command;
      if (server.args) entry.args = server.args;
      mcpServers[name] = entry;
      log.dim(`  mcp: ${name} (local)`);
    } else {
      log.warn(`  mcp: ${name} skipped (no url for remote)`);
    }
  }

  const output = { mcpServers };
  writeFile(join(outDir, "mcp.json"), JSON.stringify(output, null, 2));
  log.success("mcp.json");

  // Generate ~/.cursor/permissions.json (mcpAllowlist + terminalAllowlist)
  if (permissions?.cursor) {
    const cp = permissions.cursor;
    const cursorPerms: Record<string, unknown> = {};
    if (cp.mcpAllowlist?.length) cursorPerms.mcpAllowlist = cp.mcpAllowlist;
    if (cp.terminalAllowlist?.length) cursorPerms.terminalAllowlist = cp.terminalAllowlist;
    if (Object.keys(cursorPerms).length > 0) {
      writeFile(join(outDir, "permissions.json"), JSON.stringify(cursorPerms, null, 2));
      log.success("permissions.json");
    }
  }

  // Merge raw files into output (common first, then platform-specific to allow overrides)
  const rawCommon = join(aiDir, "raw", "common");
  if (fileExists(rawCommon)) {
    mergeOrCopyDir(rawCommon, outDir);
    log.success("raw/common/");
  }
  const rawPlatform = join(aiDir, "raw", "cursor");
  if (fileExists(rawPlatform)) {
    mergeOrCopyDir(rawPlatform, outDir);
    log.success("raw/cursor/");
  }
}
