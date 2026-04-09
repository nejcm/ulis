import { z } from "zod";

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
  model: z.enum(["opus", "sonnet", "haiku", "inherit"]).default("sonnet"),
  temperature: z.number().min(0).max(1).optional(),
  effort: z.enum(["low", "medium", "high", "max"]).optional(),

  // TOOL ACCESS (abstracted groups)
  tools: ToolPermissionsSchema,

  // EXECUTION CONTROLS
  maxTurns: z.number().int().positive().optional(),
  background: z.boolean().optional(),
  isolation: z.enum(["worktree", "none"]).optional(),

  // MEMORY & CONTEXT
  memory: z.enum(["user", "project", "local", "none"]).optional(),
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
      priority: z.enum(["low", "normal", "high"]).default("normal"),
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
      permissionLevel: z.enum(["readonly", "readwrite", "full"]).default("readwrite"),
      blockedCommands: z.array(z.string()).optional(),
      restrictedPaths: z.array(z.string()).optional(),
      requireApproval: z.array(z.enum(["write", "edit", "bash", "agent", "mcp"])).optional(),
      rateLimit: z.object({ perHour: z.number().positive() }).optional(),
    })
    .optional(),

  // UI
  color: z.enum(["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"]).optional(),
  tags: z.array(z.string()).default([]),

  // PLATFORM TARGETS & OVERRIDES
  platforms: z
    .object({
      claude: z
        .object({
          enabled: z.boolean().default(true),
          model: z.string().optional(), // exact Claude model ID, overrides top-level model + modelMap
          permissionMode: z.enum(["default", "auto", "acceptEdits", "dontAsk", "bypassPermissions", "plan"]).optional(),
          disallowedTools: z.array(z.string()).optional(),
          initialPrompt: z.string().optional(),
        })
        .optional(),
      opencode: z
        .object({
          enabled: z.boolean().default(true),
          model: z.string().optional(), // full OpenCode model ID, overrides top-level model + modelMap
          mode: z.enum(["primary", "subagent", "all"]).default("subagent"),
          top_p: z.number().min(0).max(1).optional(),
          rate_limit_per_hour: z.number().optional(),
          permission: z
            .object({
              edit: z.enum(["ask", "allow", "deny"]).optional(),
              bash: z.enum(["ask", "allow", "deny"]).optional(),
            })
            .optional(),
          hidden: z.boolean().optional(),
          disable: z.boolean().optional(),
        })
        .optional(),
      codex: z
        .object({
          enabled: z.boolean().default(true),
          model: z.string().optional(), // Codex/OpenAI model name, e.g. "o3", "gpt-4.1", "codex-mini"
          sandbox_mode: z.string().optional(),
          model_reasoning_effort: z.string().optional(),
          nickname_candidates: z.array(z.string()).optional(),
        })
        .optional(),
      cursor: z
        .object({
          enabled: z.boolean().default(true),
          model: z.string().optional(), // Cursor model ID, overrides top-level model + modelMap
          readonly: z.boolean().optional(), // maps to Cursor `readonly: true` — agent cannot modify files
          is_background: z.boolean().optional(), // maps to Cursor `is_background: true` — async non-blocking execution
        })
        .optional(),
    })
    .optional(),
});

export const McpServerSchema = z.object({
  type: z.enum(["local", "remote"]),
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
  model: z.enum(["opus", "sonnet", "haiku", "inherit"]).optional(),
  effort: z.enum(["low", "medium", "high", "max"]).optional(),
  isolation: z.enum(["fork", "none"]).optional(), // fork = Claude `context: fork`

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
          model: z.string().optional(), // exact Claude model ID, overrides top-level model + modelMap
          shell: z.enum(["bash", "powershell"]).optional(),
        })
        .optional(),
      opencode: z
        .object({
          enabled: z.boolean().default(true),
          model: z.string().optional(), // full OpenCode model ID, overrides top-level model + modelMap
        })
        .optional(),
      codex: z
        .object({
          enabled: z.boolean().default(true),
          model: z.string().optional(), // Codex/OpenAI model name, e.g. "o3", "gpt-4.1"
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
          model: z.string().optional(), // Cursor model ID, overrides top-level model + modelMap
        })
        .optional(),
    })
    .optional(),
});

export const ClaudePluginSchema = z.object({
  name: z.string(),
  source: z.string(),
  repo: z.string().optional(),
});

export const PluginsConfigSchema = z.object({
  claude: z.object({
    marketplace_plugins: z.array(ClaudePluginSchema),
    marketplace_skills: z.array(z.object({ name: z.string() })),
  }),
  opencode: z.object({
    plugins: z.array(z.string()),
  }),
});

export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;
export type McpServer = z.infer<typeof McpServerSchema>;
export type PluginsConfig = z.infer<typeof PluginsConfigSchema>;
export type ToolPermissions = z.infer<typeof ToolPermissionsSchema>;
export type ContextHints = NonNullable<AgentFrontmatter["contextHints"]>;
export type ToolPolicy = NonNullable<AgentFrontmatter["toolPolicy"]>;
export type SecurityPolicy = NonNullable<AgentFrontmatter["security"]>;
