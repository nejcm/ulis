import { z } from "zod";

import { EFFORT_LEVELS, SHELL_TYPES, SKILL_ISOLATION_MODES } from "../constants.js";
import { ALL_MODELS, CLAUDE_MODELS, CODEX_MODELS, CURSOR_MODELS, OPENCODE_MODELS } from "../models.js";
import { HooksSchema, ToolPermissionsSchema } from "./shared.js";

export const SkillFrontmatterSchema = z
  .object({
    // IDENTITY
    key: z.string().optional(),
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^(?!-)(?!.*--)(?!.*-$)[\p{Ll}\p{Nd}-]+$/u),
    description: z.string().min(1).max(1024),
    license: z.string().optional(),
    compatibility: z.string().min(1).max(500).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    "allowed-tools": z.string().optional(),

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
          .looseObject({
            enabled: z.boolean().default(true),
            model: z.enum(CLAUDE_MODELS).optional(),
            shell: z.enum(SHELL_TYPES).optional(),
          })
          .optional(),
        opencode: z
          .looseObject({
            enabled: z.boolean().default(true),
            model: z.enum(OPENCODE_MODELS).optional(),
          })
          .optional(),
        codex: z
          .looseObject({
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
          .looseObject({
            enabled: z.boolean().default(true),
            model: z.enum(CURSOR_MODELS).optional(),
          })
          .optional(),
        forgecode: z
          .looseObject({
            enabled: z.boolean().default(true),
            model: z.string().optional(),
          })
          .optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;
