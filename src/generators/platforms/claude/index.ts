import { enabledAgentsFor } from "../../../parsers/agent.js";
import { enabledRulesFor } from "../../../parsers/rule.js";
import { enabledSkillsFor } from "../../../parsers/skill.js";
import { rawDirs, sourceDirs } from "../../source-dirs.js";
import type { FileArtifact, GenerationResult, ProjectBundle } from "../../types.js";
import { buildClaudeAgentArtifact } from "./agents.js";
import { buildClaudeCommandArtifacts } from "./commands.js";
import { buildClaudeRuleArtifact } from "./rules.js";
import { buildClaudeSettingsArtifacts } from "./settings.js";
import { buildClaudeSkillDirs } from "./skills.js";

export function generateClaude(project: ProjectBundle): GenerationResult {
  const artifacts: FileArtifact[] = [];

  for (const agent of enabledAgentsFor(project.agents, "claude")) {
    artifacts.push(buildClaudeAgentArtifact(agent));
  }

  for (const rule of enabledRulesFor(project.rules, "claude")) {
    artifacts.push(buildClaudeRuleArtifact(rule));
  }

  for (const sourceDir of sourceDirs(project)) {
    artifacts.push(...buildClaudeCommandArtifacts(sourceDir));
  }
  artifacts.push(...buildClaudeSettingsArtifacts(project));

  return {
    artifacts,
    post: {
      rawDirs: rawDirs(project, "claude"),
      aliasFiles: ["CLAUDE.md"],
      skillDirs: buildClaudeSkillDirs(enabledSkillsFor(project.skills, "claude")),
    },
  };
}
