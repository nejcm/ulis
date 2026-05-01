/**
 * Scaffold templates, inlined as string constants so they survive the tsup
 * bundle without asset copying. Source-of-truth for these lives in the
 * adjacent `.template.yaml` / `.template.md` files so the JSON schema refs
 * stay in sync — when editing, update both.
 */

const CONFIG_TEMPLATE = `# yaml-language-server: $schema={{schemaBase}}/config.schema.json

version: 1
name: {{name}}
`;

const MCP_TEMPLATE = `# yaml-language-server: $schema={{schemaBase}}/mcp.schema.json

# Declare MCP (Model Context Protocol) servers that agents can use.
# Example:
#
# servers:
#   github:
#     type: local
#     command: npx
#     args: ["-y", "@modelcontextprotocol/server-github"]
#     env:
#       GITHUB_PERSONAL_ACCESS_TOKEN: \${GITHUB_PAT}
#
#   context7:
#     type: remote
#     url: https://mcp.context7.com/mcp
#     headers:
#       CONTEXT7_API_KEY: \${CONTEXT7_API_KEY}

servers: {}
`;

const PERMISSIONS_TEMPLATE = `# yaml-language-server: $schema={{schemaBase}}/permissions.schema.json

# Per-platform permission rules (allow/deny/ask patterns, approval modes, etc.)
# Each section is optional — omitted platforms use their own defaults.
#
# Example:
#
# claude:
#   defaultMode: default
#   allow:
#     - "Bash(git status)"
#     - "Bash(git diff*)"
#   deny:
#     - "Bash(rm -rf *)"
#
# opencode:
#   permission:
#     edit: ask
#     bash: ask
#
# codex:
#   approvalMode: on-request
#   sandbox: workspace-write
#
# cursor:
#   mcpAllowlist: []
#   terminalAllowlist: []
`;

const PLUGINS_TEMPLATE = `# yaml-language-server: $schema={{schemaBase}}/plugins.schema.json

# Declarative Claude Code marketplace plugin installs.
# Only "claude" is meaningful here today — other platforms don't have a
# marketplace concept. Skills live in skills.yaml.
#
# Example:
#
# claude:
#   plugins:
#     - name: frontend-design
#       source: official
#     - name: everything-claude-code
#       source: github
#       repo: affaan-m/everything-claude-code
`;

const SKILLS_TEMPLATE = `# yaml-language-server: $schema={{schemaBase}}/skills.schema.json

# Declarative skill installs per platform (via the \`skills\` CLI).
# - "*"      applies to every platform
# - "claude" / "codex" / "cursor" / "opencode" scope to one platform
#
# Example:
#
# "*":
#   skills:
#     - name: mattpocock/skills/productivity/grill-me
#     - name: anthropics/skills
#       args: ["--skill", "pdf"]
#
# claude:
#   skills:
#     - name: anthropics/skills
#       args: ["--skill", "mcp-builder"]
`;

const RULE_CODE_STYLE_TEMPLATE = `# Code Style

- Use 2-space indentation
- Prefer \`const\` over \`let\` where values are not reassigned
- Functions should be small and single-purpose
- Avoid deeply nested conditionals — prefer early returns
`;

export interface ScaffoldContext {
  readonly name: string;
  readonly schemaBase: string;
}

function substitute(content: string, context: ScaffoldContext): string {
  return content.replace(/\{\{name\}\}/g, context.name).replace(/\{\{schemaBase\}\}/g, context.schemaBase);
}

export function renderConfig(context: ScaffoldContext): string {
  return substitute(CONFIG_TEMPLATE, context);
}

export function renderMcp(context: ScaffoldContext): string {
  return substitute(MCP_TEMPLATE, context);
}

export function renderPermissions(context: ScaffoldContext): string {
  return substitute(PERMISSIONS_TEMPLATE, context);
}

export function renderPlugins(context: ScaffoldContext): string {
  return substitute(PLUGINS_TEMPLATE, context);
}

export function renderSkills(context: ScaffoldContext): string {
  return substitute(SKILLS_TEMPLATE, context);
}

export function renderRuleCodeStyle(_context: ScaffoldContext): string {
  return RULE_CODE_STYLE_TEMPLATE;
}

/** Default schema base URL when project-level templates reference local schemas. */
export const DEFAULT_SCHEMA_BASE = "./node_modules/@nejcm/ulis/schemas";
