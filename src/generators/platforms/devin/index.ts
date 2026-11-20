import { enabledSkillsFor } from "../../../parsers/skill.js";
import { rawDirs } from "../../source-dirs.js";
import type { GenerationResult, ProjectBundle } from "../../types.js";
import { buildDevinMcpArtifact } from "./mcp.js";
import { buildDevinSkillDirs } from "./skills.js";

export function generateDevin(project: ProjectBundle): GenerationResult {
  return {
    artifacts: [buildDevinMcpArtifact(project.mcp)],
    post: {
      rawDirs: rawDirs(project, "devin"),
      aliasFiles: [],
      skillDirs: buildDevinSkillDirs(enabledSkillsFor(project.skills, "devin")),
    },
  };
}
