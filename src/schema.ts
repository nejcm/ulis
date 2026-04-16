import { z } from "zod";

import {
  AGENT_COLORS,
  AGENT_ISOLATION_MODES,
  APPROVAL_ACTIONS,
  CLAUDE_PERMISSION_MODES,
  CODEX_APPROVAL_MODES,
  CONTEXT_PRIORITIES,
  EFFORT_LEVELS,
  MEMORY_SCOPES,
  OPENCODE_AGENT_MODES,
  OPENCODE_PERMISSION_ACTIONS,
  PERMISSION_LEVELS,
  SHELL_TYPES,
  SKILL_ISOLATION_MODES,
} from "./constants.js";
import { ALL_MODELS, CLAUDE_MODELS, CODEX_MODELS, CURSOR_MODELS, OPENCODE_MODELS } from "./models.js";

export const ToolPermissionsSchema = z.object({
  read: z.boolean().default(true),
  write: z.boolean().default(false),
  edit: z.boolean().default(false),
  bash: z.boolean().default(false),
  search: z.boolean().default(false),
  browser: z.boolean().default(false),
  // Can spawn subagents: true = any, string[] = allowlist of agent names
  agent: z.union([z.boolean(), z.array(z.string())]).optional(),
});

const HookEntrySchema = z.object({
  matcher: z.string().optional(),
  command: z.string(),
});

const HooksSchema = z.object({
  PreToolUse: z.array(HookEntrySchema).optional(),
  PostToolUse: z.array(HookEntrySchema).optional(),
  Stop: z.array(z.object({ command: z.string() })).optional(),
});

export const AgentFrontmatterSchema = z.object({
  // IDENTITY
  name: z.string().optional(), // can be derived from filename
  description: z.string(),

  // MODEL CONFIG
  model: z.enum(ALL_MODELS).optional(),
  temperature: z.number().min(0).max(1).optional(),
  effort: z.enum(EFFORT_LEVELS).optional(),

  // TOOL ACCESS (abstracted groups)
  tools: ToolPermissionsSchema,

  // EXECUTION CONTROLS
  maxTurns: z.number().int().positive().optional(),
  background: z.boolean().optional(),
  isolation: z.enum(AGENT_ISOLATION_MODES).optional(),

  // MEMORY & CONTEXT
  memory: z.enum(MEMORY_SCOPES).optional(),
  skills: z.array(z.string()).optional(),

  // HOOKS
  hooks: HooksSchema.optional(),

  // MCP (agent-scoped) - names from mcp.json
  mcpServers: z.array(z.string()).optional(),

  // CONTEXT WINDOW HINTS (emitted as comments; consumed by external harnesses)
  contextHints: z
    .object({
      maxInputTokens: z.number().positive().optional(),
      excludeFromContext: z.array(z.string()).optional(),
      priority: z.enum(CONTEXT_PRIORITIES).default("normal"),
    })
    .optional(),

  // TOOL SELECTION POLICY (prefer/avoid emitted as comments; requireConfirmation maps to native where supported)
  toolPolicy: z
    .object({
      prefer: z.array(z.string()).optional(),
      avoid: z.array(z.string()).optional(),
      requireConfirmation: z.array(z.string()).optional(),
    })
    .optional(),

  // SECURITY POLICY (maps to native permission controls where supported; otherwise comments)
  security: z
    .object({
      permissionLevel: z.enum(PERMISSION_LEVELS).default("readwrite"),
      blockedCommands: z.array(z.string()).optional(),
      restrictedPaths: z.array(z.string()).optional(),
      requireApproval: z.array(z.enum(APPROVAL_ACTIONS)).optional(),
      rateLimit: z.object({ perHour: z.number().positive() }).optional(),
    })
    .optional(),

  // UI
  color: z.enum(AGENT_COLORS).optional(),
  tags: z.array(z.string()).default([]),

  // PLATFORM TARGETS & OVERRIDES
  platforms: z
    .object({
      claude: z
        .object({
          enabled: z.boolean().default(true),
          model: z.enum(CLAUDE_MODELS).optional(),
          permissionMode: z.enum(CLAUDE_PERMISSION_MODES).optional(),
          disallowedTools: z.array(z.string()).optional(),
          initialPrompt: z.string().optional(),
        })
        .optional(),
      opencode: z
        .object({
          enabled: z.boolean().default(true),
          model: z.enum(OPENCODE_MODELS).optional(),
          mode: z.enum(OPENCODE_AGENT_MODES).default("subagent"),
          top_p: z.number().min(0).max(1).optional(),
          rate_limit_per_hour: z.number().optional(),
          permission: z
            .object({
              edit: z.enum(OPENCODE_PERMISSION_ACTIONS).optional(),
              bash: z.enum(OPENCODE_PERMISSION_ACTIONS).optional(),
            })
            .optional(),
          hidden: z.boolean().optional(),
          disable: z.boolean().optional(),
        })
        .optional(),
      codex: z
        .object({
          enabled: z.boolean().default(true),
          model: z.enum(CODEX_MODELS).optional(),
          sandbox_mode: z.string().optional(),
          model_reasoning_effort: z.string().optional(),
          nickname_candidates: z.array(z.string()).optional(),
        })
        .optional(),
      cursor: z
        .object({
          enabled: z.boolean().default(true),
          model: z.enum(CURSOR_MODELS).optional(),
          readonly: z.boolean().optional(), // maps to Cursor `readonly: true` — agent cannot modify files
          is_background: z.boolean().optional(), // maps to Cursor `is_background: true` — async non-blocking execution
        })
        .optional(),
    })
    .optional(),
});

export const McpServerSchema = z.object({
  type: z.enum(["local", "remote"]),
  // For remote servers: transport type used when emitting to platforms that need it (e.g. Claude Code).
  // Defaults to "http". Use "sse" only for legacy servers (SSE is deprecated in Claude Code).
  transport: z.enum(["http", "sse"]).optional(),
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  localFallback: z
    .object({
      command: z.string(),
      args: z.array(z.string()),
    })
    .optional(),
  // Enable or disable this server at the platform level. Defaults to true.
  // Respected by OpenCode (enabled field) and Codex (enabled field).
  enabled: z.boolean().optional(),
  // Omit `targets` to apply this server to every target. Use an empty array
  // to disable the server (apply to no targets).
  targets: z.array(z.string()).optional(),
});

export const McpConfigSchema = z.object({
  servers: z.record(z.string(), McpServerSchema),
});

export const SkillFrontmatterSchema = z.object({
  // IDENTITY
  name: z.string().optional(), // defaults to directory name
  description: z.string(), // max 250 chars; drives auto-invocation on all platforms

  // INVOCATION CONTROL
  argumentHint: z.string().optional(), // e.g., "[issue-number]" — Claude autocomplete
  userInvocable: z.boolean().default(true), // false = hidden from / menu (Claude)
  allowModelInvocation: z.boolean().default(true), // false = Claude won't auto-load
  allowImplicitInvocation: z.boolean().default(true), // false = Codex explicit-only ($name)

  // EXECUTION
  model: z.enum(ALL_MODELS).optional(),
  effort: z.enum(EFFORT_LEVELS).optional(),
  isolation: z.enum(SKILL_ISOLATION_MODES).optional(), // fork = Claude `context: fork`

  // TOOL ACCESS (reuses existing ToolPermissionsSchema)
  tools: ToolPermissionsSchema.optional(),

  // HOOKS (reuses existing HooksSchema)
  hooks: HooksSchema.optional(),

  // ACTIVATION SCOPE
  paths: z.union([z.string(), z.array(z.string())]).optional(),

  // METADATA
  category: z.string().optional(),
  tags: z.array(z.string()).default([]),
  version: z.string().optional(),

  // PLATFORM TARGETS & OVERRIDES
  platforms: z
    .object({
      claude: z
        .object({
          enabled: z.boolean().default(true),
          model: z.enum(CLAUDE_MODELS).optional(),
          shell: z.enum(SHELL_TYPES).optional(),
        })
        .optional(),
      opencode: z
        .object({
          enabled: z.boolean().default(true),
          model: z.enum(OPENCODE_MODELS).optional(),
        })
        .optional(),
      codex: z
        .object({
          enabled: z.boolean().default(true),
          model: z.enum(CODEX_MODELS).optional(),
          // UI/branding (maps to agents/openai.yaml `interface` block)
          displayName: z.string().optional(),
          shortDescription: z.string().optional(),
          iconSmall: z.string().optional(),
          iconLarge: z.string().optional(),
          brandColor: z.string().optional(),
          defaultPrompt: z.string().optional(),
          // MCP tool dependencies
          mcpDependencies: z
            .array(
              z.object({
                type: z.literal("mcp"),
                value: z.string(),
                description: z.string().optional(),
                transport: z.string().optional(),
                url: z.string().optional(),
              }),
            )
            .optional(),
        })
        .optional(),
      cursor: z
        .object({
          enabled: z.boolean().default(true),
          model: z.enum(CURSOR_MODELS).optional(),
        })
        .optional(),
    })
    .optional(),
});

export const CommandFrontmatterSchema = z
  .object({
    description: z.string(),
    model: z.enum(ALL_MODELS).optional(),
    // Which agent executes this command (opencode)
    agent: z.string().optional(),
    // Force subagent invocation (opencode)
    subtask: z.boolean().optional(),
    platforms: z
      .object({
        opencode: z
          .object({
            enabled: z.boolean().default(true),
            model: z.enum(OPENCODE_MODELS).optional(),
            agent: z.string().optional(),
            subtask: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();

export type CommandFrontmatter = z.infer<typeof CommandFrontmatterSchema>;

export const ClaudePluginSchema = z.object({
  name: z.string(),
  source: z.string(),
  repo: z.string().optional(),
});

export const GlobalSkillSchema = z.object({
  name: z.string(),
  args: z.array(z.string()).optional(),
});

const sharedPluginsSchema = z.object({
  plugins: z.array(ClaudePluginSchema),
  skills: z.array(GlobalSkillSchema).default([]),
});

export const PluginsConfigSchema = z.object({
  "*": sharedPluginsSchema.optional(),
  claude: sharedPluginsSchema.optional(),
  opencode: sharedPluginsSchema.optional(),
  codex: sharedPluginsSchema.optional(),
  cursor: sharedPluginsSchema.optional(),
});

// ─── Permissions Config ────────────────────────────────────────────────────

const PermissionActionSchema = z.enum(["allow", "ask", "deny"]);
const PermissionRuleSchema = z.union([
  PermissionActionSchema,
  z.record(z.string(), PermissionActionSchema), // pattern → action
]);

export const PermissionsConfigSchema = z
  .object({
    claude: z
      .object({
        defaultMode: z.enum(CLAUDE_PERMISSION_MODES).optional(),
        allow: z.array(z.string()).optional(), // e.g. ["Bash(npm run *)", "Read(**)"]
        deny: z.array(z.string()).optional(),
        ask: z.array(z.string()).optional(),
        additionalDirectories: z.array(z.string()).optional(),
      })
      .optional(),

    opencode: z
      .object({
        permission: z
          .object({
            read: PermissionRuleSchema,
            edit: PermissionRuleSchema,
            glob: PermissionRuleSchema,
            grep: PermissionRuleSchema,
            list: PermissionRuleSchema,
            external_directory: PermissionRuleSchema,
            bash: PermissionRuleSchema,
            task: PermissionRuleSchema,
            skill: PermissionRuleSchema,
            question: PermissionRuleSchema,
            webfetch: PermissionRuleSchema,
            websearch: PermissionRuleSchema,
            codesearch: PermissionRuleSchema,
            lsp: PermissionRuleSchema,
            todowrite: PermissionRuleSchema,
            doom_loop: PermissionRuleSchema,
          })
          .partial()
          .optional(),
      })
      .optional(),

    codex: z
      .object({
        approvalMode: z.enum(CODEX_APPROVAL_MODES).optional(),
        sandbox: z.string().optional(),
        trustedProjects: z.record(z.string(), z.string()).optional(),
      })
      .optional(),

    cursor: z
      .object({
        // ~/.cursor/permissions.json — overrides in-app allowlists when present
        // Format: "server:tool" — e.g. "github:*", "*:list_*", "*:*"
        mcpAllowlist: z.array(z.string()).optional(),
        // Format: command prefix — e.g. "git", "npm", "cargo build"
        terminalAllowlist: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .optional();

export type PermissionsConfig = z.infer<typeof PermissionsConfigSchema>;

// ─── Type exports ─────────────────────────────────────────────────────────

export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;
export type McpServer = z.infer<typeof McpServerSchema>;
export type PluginsConfig = z.infer<typeof PluginsConfigSchema>;
export type GlobalSkill = z.infer<typeof GlobalSkillSchema>;
export type ToolPermissions = z.infer<typeof ToolPermissionsSchema>;
export type ContextHints = NonNullable<AgentFrontmatter["contextHints"]>;
export type ToolPolicy = NonNullable<AgentFrontmatter["toolPolicy"]>;
export type SecurityPolicy = NonNullable<AgentFrontmatter["security"]>;
