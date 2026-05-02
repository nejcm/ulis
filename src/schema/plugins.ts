import { z } from "zod";

import { emptyYamlAsEmptyObject } from "../utils/yaml.js";

export const PluginSchema = z.object({
  name: z.string(),
  source: z.string(),
  repo: z.string().optional(),
});

const PER_PLATFORM_PLUGINS_SCHEMA = z
  .object({
    plugins: z.array(PluginSchema).optional().nullable(),
  })
  .optional()
  .nullable();

export const PluginsConfigSchema = emptyYamlAsEmptyObject(
  z.object({
    "*": PER_PLATFORM_PLUGINS_SCHEMA,
    claude: PER_PLATFORM_PLUGINS_SCHEMA,
    opencode: PER_PLATFORM_PLUGINS_SCHEMA,
    codex: PER_PLATFORM_PLUGINS_SCHEMA,
    cursor: PER_PLATFORM_PLUGINS_SCHEMA,
  }),
);

/**
 * @deprecated Use `PluginSchema` instead.
 */
export const PLuginSchema = PluginSchema;

export type PluginsConfig = z.infer<typeof PluginsConfigSchema>;
