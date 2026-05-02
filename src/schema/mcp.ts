import { z } from "zod";

import { emptyYamlAsEmptyObject } from "../utils/yaml.js";

export const McpServerSchema = z.object({
  type: z.enum(["local", "remote"]),
  // For remote servers: transport type used when emitting to platforms that need it (e.g. Claude Code).
  // Defaults to "http". Use "sse" only for legacy servers (SSE is deprecated in Claude Code).
  transport: z.enum(["http", "sse"]).optional(),
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  localFallback: z
    .object({
      command: z.string(),
      args: z.array(z.string()),
    })
    .optional(),
  // Enable or disable this server at the platform level. Defaults to true.
  // Respected by OpenCode (enabled field) and Codex (enabled field).
  enabled: z.boolean().optional(),
  // Omit `targets` to apply this server to every target. Use an empty array
  // to disable the server (apply to no targets).
  targets: z.array(z.string()).optional(),
});

export const McpConfigSchema = emptyYamlAsEmptyObject(
  z.object({
    servers: z.record(z.string(), McpServerSchema).default({}),
  }),
);

export type McpServer = z.infer<typeof McpServerSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;
