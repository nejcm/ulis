import { z } from "zod";

import { ALL_MODELS, OPENCODE_MODELS } from "../models.js";
import { knownStringSchema } from "./shared.js";

const ModelSchema = knownStringSchema(ALL_MODELS);
const OpenCodeModelSchema = knownStringSchema(OPENCODE_MODELS);

export const CommandFrontmatterSchema = z
  .object({
    description: z.string(),
    model: ModelSchema.optional(),
    // Which agent executes this command (opencode)
    agent: z.string().optional(),
    // Force subagent invocation (opencode)
    subtask: z.boolean().optional(),
    platforms: z
      .object({
        opencode: z
          .object({
            enabled: z.boolean().default(true),
            model: OpenCodeModelSchema.optional(),
            agent: z.string().optional(),
            subtask: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();

export type CommandFrontmatter = z.infer<typeof CommandFrontmatterSchema>;
