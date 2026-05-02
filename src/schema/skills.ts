import { z } from "zod";

import { emptyYamlAsEmptyObject } from "../utils/yaml.js";

export const GlobalSkillSchema = z.object({
  key: z.string().optional(),
  name: z.string(),
  args: z.array(z.string()).optional(),
});

const PER_PLATFORM_SKILLS_SCHEMA = z.object({
  skills: z.array(GlobalSkillSchema).default([]),
});

export const SkillsConfigSchema = emptyYamlAsEmptyObject(
  z.object({
    "*": PER_PLATFORM_SKILLS_SCHEMA.optional(),
    claude: PER_PLATFORM_SKILLS_SCHEMA.optional(),
    opencode: PER_PLATFORM_SKILLS_SCHEMA.optional(),
    codex: PER_PLATFORM_SKILLS_SCHEMA.optional(),
    cursor: PER_PLATFORM_SKILLS_SCHEMA.optional(),
    forgecode: PER_PLATFORM_SKILLS_SCHEMA.optional(),
  }),
);

export type SkillsConfig = z.infer<typeof SkillsConfigSchema>;
export type GlobalSkill = z.infer<typeof GlobalSkillSchema>;
