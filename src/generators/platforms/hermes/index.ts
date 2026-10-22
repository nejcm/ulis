import { enabledSkillsFor } from "../../../parsers/skill.js";
import { rawDirs } from "../../source-dirs.js";
import type { GenerationResult, ProjectBundle } from "../../types.js";
import { buildHermesMcpArtifact } from "./mcp.js";
import { buildHermesSkillDirs } from "./skills.js";

export function generateHermes(project: ProjectBundle): GenerationResult {
  return {
    artifacts: [buildHermesMcpArtifact(project.mcp)],
    post: {
      rawDirs: rawDirs(project, "hermes"),
      aliasFiles: [],
      skillDirs: buildHermesSkillDirs(enabledSkillsFor(project.skills, "hermes")),
    },
  };
}
