import { z } from "zod";

export const ToolPermissionsSchema = z
  .object({
    read: z.boolean().default(true),
    write: z.boolean().default(false),
    edit: z.boolean().default(false),
    bash: z.boolean().default(false),
    search: z.boolean().default(false),
    browser: z.boolean().default(false),
    // Can spawn subagents: true = any, string[] = allowlist of agent names
    agent: z.union([z.boolean(), z.array(z.string())]).optional(),
  })
  .or(z.string());

const HookEntrySchema = z.object({
  matcher: z.string().optional(),
  command: z.string(),
});

export const HooksSchema = z.object({
  PreToolUse: z.array(HookEntrySchema).optional(),
  PostToolUse: z.array(HookEntrySchema).optional(),
  Stop: z.array(z.object({ command: z.string() })).optional(),
});

export type ToolPermissions = z.infer<typeof ToolPermissionsSchema>;
