import { z } from "zod";

/**
 * A package a `skills.yaml` or `extensions.yaml` entry names, for `npx <name>` / `bunx <name>`.
 * Legitimate values are npm specs, `owner/repo/path` shorthands and https URLs; none of them begins
 * with `-`, and a name that does lands in option position instead of argument position - a remote
 * source naming a skill `--registry=https://evil.example` would redirect the install the user just
 * approved. Whitespace is refused for the same reason it is refused in argv on Windows: it splits
 * one reviewed argument into two.
 */
export const PackageNameSchema = z
  .string()
  .regex(/^[^-\s]\S*$/u, "must not start with '-' or contain whitespace, or it would read as a command-line option");

export function knownStringSchema<T extends readonly [string, ...string[]]>(values: T) {
  return z.union([z.enum(values), z.string()]);
}

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

export type Hooks = z.infer<typeof HooksSchema>;
export type ToolPermissions = z.infer<typeof ToolPermissionsSchema>;
