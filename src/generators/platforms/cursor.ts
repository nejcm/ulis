import { join } from "node:path";

import { enabledAgentsFor } from "../../parsers/agent.js";
import { enabledRulesFor } from "../../parsers/rule.js";
import { enabledSkillsFor } from "../../parsers/skill.js";
import { mcpServersFor, translateEnvMap } from "../../utils/mcp-block.js";
import { buildPolicyCommentBlock } from "../../utils/policy-comments.js";
import { mapTools } from "../../utils/tool-mapper.js";
import type { FileArtifact, GenerationResult, ProjectBundle } from "../types.js";
import { extraToYamlLines } from "../shared/yaml.js";

export function generateCursor(project: ProjectBundle): GenerationResult {
  const artifacts: FileArtifact[] = [];

  // Agents — .mdc files with YAML frontmatter
  for (const agent of enabledAgentsFor(project.agents, "cursor")) {
    const { frontmatter: fm } = agent;
    const cursorPlatform = fm.platforms?.cursor;

    const {
      enabled: _enabled,
      model: _model,
      readonly: _readonly,
      is_background: _is_background,
      ...cursorExtra
    } = (cursorPlatform ?? {}) as Record<string, unknown>;

    const model = cursorPlatform?.model ?? fm.model;
    const tools = mapTools(fm.tools, "cursor");

    const isReadonly = cursorPlatform?.readonly ?? fm.security?.permissionLevel === "readonly";
    const isBackground = cursorPlatform?.is_background ?? fm.background ?? false;

    const lines = ["---", `description: ${fm.description}`];
    if (model) lines.push(`model: ${model}`);
    if (isReadonly) lines.push(`readonly: true`);
    if (isBackground) lines.push(`is_background: true`);
    if (tools.length > 0) {
      lines.push(`tools:`);
      for (const tool of tools) lines.push(`  - ${tool}`);
    }
    lines.push(...extraToYamlLines(cursorExtra));
    lines.push("---");

    const policyBlock = buildPolicyCommentBlock(fm, "mdc");
    const bodyWithPolicy = policyBlock ? `${policyBlock}\n${agent.body.trim()}` : agent.body.trim();
    artifacts.push({
      path: join("agents", `${agent.name}.mdc`),
      contents: `${lines.join("\n")}\n\n${bodyWithPolicy}\n`,
    });
  }

  // Rules — .mdc, with `paths` renamed to `globs`
  for (const rule of enabledRulesFor(project.rules, "cursor")) {
    const fm = rule.frontmatter;
    const fmLines: string[] = ["---"];
    if (fm.description) fmLines.push(`description: ${fm.description}`);
    if (fm.paths?.length) {
      fmLines.push("globs:");
      for (const p of fm.paths) fmLines.push(`  - "${p}"`);
    }
    if (fm.alwaysApply) fmLines.push("alwaysApply: true");
    fmLines.push("---");
    const hasFrontmatter = fm.description || fm.paths?.length || fm.alwaysApply;
    const mdcFilename = rule.filename.replace(/\.md$/, ".mdc");
    const contents = hasFrontmatter ? `${fmLines.join("\n")}\n\n${rule.body}\n` : `${rule.body}\n`;
    artifacts.push({ path: join("rules", mdcFilename), contents });
  }

  // mcp.json — always emitted
  const mcpServers: Record<string, unknown> = {};
  for (const [name, server] of mcpServersFor(project.mcp, "cursor")) {
    if (server.type === "remote" && server.url) {
      const entry: Record<string, unknown> = { url: server.url };
      const headers = translateEnvMap(server.headers, "cursor");
      if (headers) entry.headers = headers;
      mcpServers[name] = entry;
    } else if (server.type === "local") {
      const entry: Record<string, unknown> = {};
      if (server.command) entry.command = server.command;
      if (server.args) entry.args = server.args;
      mcpServers[name] = entry;
    }
  }
  artifacts.push({ path: "mcp.json", contents: JSON.stringify({ mcpServers }, null, 2) });

  // permissions.json — only if cursor permissions are configured
  if (project.permissions?.cursor) {
    const cp = project.permissions.cursor;
    const cursorPerms: Record<string, unknown> = {};
    if (cp.mcpAllowlist?.length) cursorPerms.mcpAllowlist = cp.mcpAllowlist;
    if (cp.terminalAllowlist?.length) cursorPerms.terminalAllowlist = cp.terminalAllowlist;
    if (Object.keys(cursorPerms).length > 0) {
      artifacts.push({ path: "permissions.json", contents: JSON.stringify(cursorPerms, null, 2) });
    }
  }

  return {
    artifacts,
    post: {
      rawDirs: [join(project.sourceDir, "raw", "common"), join(project.sourceDir, "raw", "cursor")],
      aliasFiles: [],
      skillDirs: enabledSkillsFor(project.skills, "cursor").map((s) => {
        const p = s.frontmatter.platforms?.cursor;
        const { enabled: _e, model: _m, ...extra } = (p ?? {}) as Record<string, unknown>;
        const model = p?.model ?? s.frontmatter.model;
        return { name: s.name, dir: s.dir, extraFrontmatter: { ...(model ? { model } : {}), ...extra } };
      }),
    },
  };
}
