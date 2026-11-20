import { enabledRulesFor } from "../../../parsers/rule.js";
import { enabledSkillsFor } from "../../../parsers/skill.js";
import { buildTriggerRuleArtifacts } from "../../shared/trigger-rules.js";
import { rawDirs } from "../../source-dirs.js";
import type { GenerationResult, ProjectBundle } from "../../types.js";
import { buildDevinMcpArtifact } from "./mcp.js";
import { buildDevinSkillDirs } from "./skills.js";

export function generateDevin(project: ProjectBundle): GenerationResult {
  return {
    artifacts: [
      // Devin CLI 3000.14 rejects a string `globs` with "expected a sequence".
      ...buildTriggerRuleArtifacts(enabledRulesFor(project.rules, "devin"), "Devin", "list"),
      buildDevinMcpArtifact(project.mcp),
    ],
    post: {
      rawDirs: rawDirs(project, "devin"),
      aliasFiles: [],
      skillDirs: buildDevinSkillDirs(enabledSkillsFor(project.skills, "devin")),
    },
  };
}
