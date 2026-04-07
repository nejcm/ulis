import { join } from "node:path";
import type { ParsedAgent } from "../parsers/agent.js";
import type { ParsedSkill } from "../parsers/skill.js";
import type { McpConfig } from "../schema.js";
import { writeFile, copyDir, cleanDir } from "../utils/fs.js";
import { translateEnvVar } from "../utils/env-var.js";
import { log } from "../utils/logger.js";
import { buildPolicyCommentBlock } from "../utils/policy-comments.js";

const MODEL_MAP: Record<string, string> = {
  opus: "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
};

function buildCursorTools(agent: ParsedAgent): string[] {
  const tools: string[] = [];
  const { tools: t } = agent.frontmatter;
  if (t.read) tools.push("read_file", "list_directory", "search_files");
  if (t.write) tools.push("write_file");
  if (t.edit) tools.push("edit_file");
  if (t.bash) tools.push("run_terminal_command");
  if (t.search) tools.push("web_search");
  if (t.browser) tools.push("browser_action");
  return tools;
}

export function generateCursor(
  agents: readonly ParsedAgent[],
  skills: readonly ParsedSkill[],
  mcp: McpConfig,
  outDir: string,
): void {
  cleanDir(outDir);
  log.header("Cursor");

  // Generate agent .mdc files
  const enabledAgents = agents.filter((a) => a.frontmatter.platforms?.cursor?.enabled !== false);

  for (const agent of enabledAgents) {
    const { frontmatter: fm } = agent;
    const model = MODEL_MAP[fm.model] ?? fm.model;
    const tools = buildCursorTools(agent);

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
    const bodyWithPolicy = policyBlock
      ? `${policyBlock}\n${agent.body.trim()}`
      : agent.body.trim();
    const content = `${frontmatterLines.join("\n")}\n\n${bodyWithPolicy}\n`;
    writeFile(join(outDir, "agents", `${agent.name}.mdc`), content);
    log.dim(`  agent: ${agent.name}`);
  }
  if (enabledAgents.length > 0) {
    log.success(`agents/ (${enabledAgents.length} agents generated)`);
  }

  // Copy skill directories for Cursor (follows Agent Skills open standard — same format as OpenCode)
  const enabledSkills = skills.filter((s) => s.frontmatter.platforms?.cursor?.enabled !== false);
  for (const skill of enabledSkills) {
    copyDir(skill.dir, join(outDir, "skills", skill.name));
    log.dim(`  skill: ${skill.name}`);
  }
  if (enabledSkills.length > 0) {
    log.success(`skills/ (${enabledSkills.length} skills)`);
  }

  // Generate mcp.json
  const mcpServers: Record<string, unknown> = {};

  for (const [name, server] of Object.entries(mcp.servers)) {
    if (!server.targets.includes("cursor")) continue;

    if (server.type === "remote" && server.url) {
      const entry: Record<string, unknown> = { url: server.url };
      if (server.headers) {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(server.headers)) {
          headers[k] = translateEnvVar(v, "cursor");
        }
        entry.headers = headers;
      }
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
}
