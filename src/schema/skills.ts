import { z } from "zod";

export const GlobalSkillSchema = z.object({
  key: z.string().optional(),
  name: z.string(),
  args: z.array(z.string()).optional(),
});

const perPlatformSkillsSchema = z.object({
  skills: z.array(GlobalSkillSchema).default([]),
});

export const SkillsConfigSchema = z.object({
  "*": perPlatformSkillsSchema.optional(),
  claude: perPlatformSkillsSchema.optional(),
  opencode: perPlatformSkillsSchema.optional(),
  codex: perPlatformSkillsSchema.optional(),
  cursor: perPlatformSkillsSchema.optional(),
  forgecode: perPlatformSkillsSchema.optional(),
});

export type SkillsConfig = z.infer<typeof SkillsConfigSchema>;
export type GlobalSkill = z.infer<typeof GlobalSkillSchema>;
