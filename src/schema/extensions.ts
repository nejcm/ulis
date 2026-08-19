import { z } from "zod";

import { emptyYamlAsEmptyObject } from "../utils/yaml.js";
import { PackageNameSchema } from "./shared.js";

export const ExtensionSchema = z.object({
  key: z.string().optional(),
  name: PackageNameSchema,
  args: z.array(z.string()).optional(),
});

const PER_PLATFORM_EXTENSIONS_SCHEMA = z.object({
  extensions: z.array(ExtensionSchema).default([]),
});

export const ExtensionsConfigSchema = emptyYamlAsEmptyObject(
  z.object({
    "*": PER_PLATFORM_EXTENSIONS_SCHEMA.optional(),
    claude: PER_PLATFORM_EXTENSIONS_SCHEMA.optional(),
    opencode: PER_PLATFORM_EXTENSIONS_SCHEMA.optional(),
    codex: PER_PLATFORM_EXTENSIONS_SCHEMA.optional(),
    cursor: PER_PLATFORM_EXTENSIONS_SCHEMA.optional(),
    forgecode: PER_PLATFORM_EXTENSIONS_SCHEMA.optional(),
  }),
);

export type ExtensionsConfig = z.infer<typeof ExtensionsConfigSchema>;
export type Extension = z.infer<typeof ExtensionSchema>;
