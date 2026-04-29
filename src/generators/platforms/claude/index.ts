import { join } from "node:path";

import { enabledAgentsFor } from "../../../parsers/agent.js";
import { enabledRulesFor } from "../../../parsers/rule.js";
import type { FileArtifact, GenerationResult, ProjectBundle } from "../../types.js";
import { buildClaudeAgentArtifact } from "./agents.js";
import { buildClaudeCommandArtifacts } from "./commands.js";
import { buildClaudeRuleArtifact } from "./rules.js";
import { buildClaudeSettingsArtifacts } from "./settings.js";

export function generateClaude(project: ProjectBundle): GenerationResult {
  const artifacts: FileArtifact[] = [];

  for (const agent of enabledAgentsFor(project.agents, "claude")) {
    artifacts.push(buildClaudeAgentArtifact(agent));
  }

  for (const rule of enabledRulesFor(project.rules, "claude")) {
    artifacts.push(buildClaudeRuleArtifact(rule));
  }

  artifacts.push(...buildClaudeCommandArtifacts(project.sourceDir));
  artifacts.push(...buildClaudeSettingsArtifacts(project));

  return {
    artifacts,
    post: {
      rawDirs: [join(project.sourceDir, "raw", "common"), join(project.sourceDir, "raw", "claude")],
      aliasFiles: ["CLAUDE.md"],
      skillDirs: [],
    },
  };
}
