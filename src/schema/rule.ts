import { z } from "zod";

export const RuleFrontmatterSchema = z.object({
  description: z.string().optional(),
  paths: z.array(z.string()).optional(),
  alwaysApply: z.boolean().default(false),
  platforms: z
    .object({
      claude: z.object({ enabled: z.boolean().default(true) }).optional(),
      opencode: z.object({ enabled: z.boolean().default(true) }).optional(),
      codex: z.object({ enabled: z.boolean().default(true) }).optional(),
      cursor: z.object({ enabled: z.boolean().default(true) }).optional(),
      forgecode: z.object({ enabled: z.boolean().default(true) }).optional(),
      antigravity: z.object({ enabled: z.boolean().default(true) }).optional(),
    })
    .optional(),
});

export type RuleFrontmatter = z.infer<typeof RuleFrontmatterSchema>;
