import { enabledAgentsFor } from "../../../parsers/agent.js";
import { enabledRulesFor } from "../../../parsers/rule.js";
import { enabledSkillsFor } from "../../../parsers/skill.js";
import { buildTriggerRuleArtifacts } from "../../shared/trigger-rules.js";
import { rawDirs } from "../../source-dirs.js";
import type { FileArtifact, GenerationResult, ProjectBundle } from "../../types.js";
import { buildAntigravityAgentArtifact } from "./agents.js";
import { buildAntigravityMcpArtifact } from "./mcp.js";
import { buildAntigravitySkillDirs } from "./skills.js";

export function generateAntigravity(project: ProjectBundle): GenerationResult {
  const artifacts: FileArtifact[] = [];

  for (const agent of enabledAgentsFor(project.agents, "antigravity")) {
    artifacts.push(buildAntigravityAgentArtifact(agent));
  }

  artifacts.push(...buildTriggerRuleArtifacts(enabledRulesFor(project.rules, "antigravity"), "Antigravity"));
  artifacts.push(buildAntigravityMcpArtifact(project.mcp));

  return {
    artifacts,
    post: {
      rawDirs: rawDirs(project, "antigravity"),
      aliasFiles: [],
      skillDirs: buildAntigravitySkillDirs(enabledSkillsFor(project.skills, "antigravity")),
    },
  };
}
