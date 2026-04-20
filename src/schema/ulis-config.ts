import { z } from "zod";

/**
 * Top-level schema for `.ulis/config.yaml`.
 *
 * Kept intentionally minimal in v1. Platform- and agent-level options live
 * in their own files (`mcp.yaml`, `permissions.yaml`, `plugins.yaml`, and
 * per-agent/skill frontmatter).
 */
export const UlisConfigSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
});

export type UlisConfig = z.infer<typeof UlisConfigSchema>;
