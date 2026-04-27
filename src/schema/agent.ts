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
} from "../constants.js";
import { ALL_MODELS, CLAUDE_MODELS, CODEX_MODELS, CURSOR_MODELS, OPENCODE_MODELS } from "../models.js";
import { HooksSchema, ToolPermissionsSchema } from "./shared.js";

export const AgentFrontmatterSchema = z
  .object({
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
          .looseObject({
            enabled: z.boolean().default(true),
            model: z.enum(CLAUDE_MODELS).optional(),
            permissionMode: z.enum(CLAUDE_PERMISSION_MODES).optional(),
            disallowedTools: z.array(z.string()).optional(),
            initialPrompt: z.string().optional(),
          })
          .optional(),
        opencode: z
          .looseObject({
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
          .looseObject({
            enabled: z.boolean().default(true),
            model: z.enum(CODEX_MODELS).optional(),
            sandbox_mode: z.string().optional(),
            model_reasoning_effort: z.string().optional(),
            nickname_candidates: z.array(z.string()).optional(),
            mcp_servers: z.record(z.string(), z.unknown()).optional(),
          })
          .optional(),
        cursor: z
          .looseObject({
            enabled: z.boolean().default(true),
            model: z.enum(CURSOR_MODELS).optional(),
            readonly: z.boolean().optional(),
            is_background: z.boolean().optional(),
          })
          .optional(),
        forgecode: z
          .looseObject({
            enabled: z.boolean().default(true),
            model: z.string().optional(),
            provider: z.string().optional(),
            temperature: z.number().min(0).max(2).optional(),
            top_p: z.number().min(0).max(1).optional(),
            top_k: z.number().int().min(1).max(1000).optional(),
            max_tokens: z.number().int().min(1).max(100000).optional(),
            max_turns: z.number().int().positive().optional(),
            max_requests_per_turn: z.number().int().positive().optional(),
            max_tool_failure_per_turn: z.number().int().positive().optional(),
            tool_supported: z.boolean().optional(),
            user_prompt: z.string().optional(),
            reasoning: z
              .looseObject({
                enabled: z.boolean().optional(),
                effort: z.enum(["low", "medium", "high"]).optional(),
                max_tokens: z.number().int().positive().optional(),
                exclude: z.boolean().optional(),
              })
              .optional(),
          })
          .optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;
export type ContextHints = NonNullable<AgentFrontmatter["contextHints"]>;
export type ToolPolicy = NonNullable<AgentFrontmatter["toolPolicy"]>;
export type SecurityPolicy = NonNullable<AgentFrontmatter["security"]>;
