import { z } from "zod";

export const PresetMetaSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  version: z.number().int().optional(),
});

export type PresetMeta = z.infer<typeof PresetMetaSchema>;
