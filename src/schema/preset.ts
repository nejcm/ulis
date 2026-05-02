import { z } from "zod";

import { emptyYamlAsEmptyObject } from "../utils/yaml";

export const PresetMetaSchema = emptyYamlAsEmptyObject(
  z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    version: z.number().int().optional(),
  }),
);

export type PresetMeta = z.infer<typeof PresetMetaSchema>;
