import { z } from "zod";

export const PLuginSchema = z.object({
  name: z.string(),
  source: z.string(),
  repo: z.string().optional(),
});

const perPlatformPluginsSchema = z.object({
  plugins: z.array(PLuginSchema).optional().nullable(),
}).optional().nullable();

export const PluginsConfigSchema = z.object({
  "*": perPlatformPluginsSchema,
  claude: perPlatformPluginsSchema,
  opencode: perPlatformPluginsSchema,
  codex: perPlatformPluginsSchema,
  cursor: perPlatformPluginsSchema,
}).optional().nullable();

export type PluginsConfig = z.infer<typeof PluginsConfigSchema>;
