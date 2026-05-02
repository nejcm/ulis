import { z } from "zod";

import { emptyYamlAsEmptyObject } from "../utils/yaml";

/**
 * Top-level schema for `.ulis/config.yaml`.
 *
 * Kept intentionally minimal in v1. Platform- and agent-level options live
 * in their own files (`mcp.yaml`, `permissions.yaml`, `plugins.yaml`, and
 * per-agent/skill frontmatter).
 */
export const UlisConfigSchema = emptyYamlAsEmptyObject(
  z.object({
    version: z.literal(1).default(1),
    name: z.string().min(1).default("ulis"),
    /**
     * Controls how rules are handled for platforms that don't support a native
     * rules directory (OpenCode, Codex, ForgeCode).
     *
     * - `inject` (default): Append a Rules Index section to the platform's main
     *   instructions file (AGENTS.md) so the AI can discover and
     *   apply rules contextually.
     * - `exclude`: Skip rules entirely for unsupported platforms.
     */
    unsupportedPlatformRules: z.enum(["inject", "exclude"]).default("inject").optional(),
  }),
);

export type UlisConfig = z.infer<typeof UlisConfigSchema>;
