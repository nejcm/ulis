import { z } from "zod";

import { CLAUDE_PERMISSION_MODES, CODEX_APPROVAL_MODES } from "../constants.js";
import { emptyYamlAsEmptyObject } from "../utils/yaml.js";

const PermissionActionSchema = z.enum(["allow", "ask", "deny"]);
const PermissionRuleSchema = z.union([
  PermissionActionSchema,
  z.record(z.string(), PermissionActionSchema), // pattern → action
]);

export const PermissionsConfigSchema = emptyYamlAsEmptyObject(
  z.object({
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
  }),
);

export type PermissionsConfig = z.infer<typeof PermissionsConfigSchema>;
