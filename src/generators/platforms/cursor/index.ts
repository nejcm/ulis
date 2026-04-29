import { join } from "node:path";

import { enabledAgentsFor } from "../../../parsers/agent.js";
import { enabledRulesFor } from "../../../parsers/rule.js";
import { enabledSkillsFor } from "../../../parsers/skill.js";
import type { FileArtifact, GenerationResult, ProjectBundle } from "../../types.js";
import { buildCursorAgentArtifact } from "./agents.js";
import { buildCursorConfigArtifacts } from "./config.js";
import { buildCursorRuleArtifact } from "./rules.js";
import { buildCursorSkillDirs } from "./skills.js";

export function generateCursor(project: ProjectBundle): GenerationResult {
  const artifacts: FileArtifact[] = [];

  for (const agent of enabledAgentsFor(project.agents, "cursor")) {
    artifacts.push(buildCursorAgentArtifact(agent));
  }

  for (const rule of enabledRulesFor(project.rules, "cursor")) {
    artifacts.push(buildCursorRuleArtifact(rule));
  }

  artifacts.push(...buildCursorConfigArtifacts(project));

  return {
    artifacts,
    post: {
      rawDirs: [join(project.sourceDir, "raw", "common"), join(project.sourceDir, "raw", "cursor")],
      aliasFiles: [],
      skillDirs: buildCursorSkillDirs(enabledSkillsFor(project.skills, "cursor")),
    },
  };
}
