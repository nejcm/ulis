import { join } from "node:path";

import type { BuildConfig } from "../config.js";
import { type ParsedAgent, enabledAgentsFor } from "../parsers/agent.js";
import { type ParsedSkill, enabledSkillsFor } from "../parsers/skill.js";
import type { McpConfig } from "../schema.js";
import { writeFile, cleanDir, copySkillDirs, copyDir, fileExists } from "../utils/fs.js";
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
  cfg: BuildConfig,
): void {
  cleanDir(outDir);
  log.header("Cursor");

  const modelMap = cfg.platforms.cursor.modelMap;

  // Generate agent .mdc files
  const enabledAgents = enabledAgentsFor(agents, "cursor");

  for (const agent of enabledAgents) {
    const { frontmatter: fm } = agent;
    const model = modelMap[fm.model] ?? fm.model;
    const tools = mapTools(fm.tools, "cursor", cfg);

    const frontmatterLines = ["---"];
    frontmatterLines.push(`description: ${fm.description}`);
    if (model && model !== "inherit") {
      frontmatterLines.push(`model: ${model}`);
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

  // Copy raw/common files (preserve subfolder structure)
  const rawCommon = join(aiDir, "raw", "common");
  if (fileExists(rawCommon)) {
    copyDir(rawCommon, outDir);
    log.success("raw/common/");
  }
}
