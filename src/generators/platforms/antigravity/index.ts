import { enabledAgentsFor } from "../../../parsers/agent.js";
import { enabledRulesFor } from "../../../parsers/rule.js";
import { enabledSkillsFor } from "../../../parsers/skill.js";
import { rawDirs } from "../../source-dirs.js";
import type { FileArtifact, GenerationResult, ProjectBundle } from "../../types.js";
import { buildAntigravityAgentArtifact } from "./agents.js";
import { buildAntigravityMcpArtifact } from "./mcp.js";
import { buildAntigravityRuleArtifact } from "./rules.js";
import { buildAntigravitySkillDirs } from "./skills.js";

export function generateAntigravity(project: ProjectBundle): GenerationResult {
  const artifacts: FileArtifact[] = [];

  for (const agent of enabledAgentsFor(project.agents, "antigravity")) {
    artifacts.push(buildAntigravityAgentArtifact(agent));
  }

  const ruleSources = new Map<string, string>();
  for (const rule of enabledRulesFor(project.rules, "antigravity")) {
    const artifact = buildAntigravityRuleArtifact(rule);
    const clash = ruleSources.get(artifact.path);
    if (clash) throw new Error(`Rules "${clash}" and "${rule.name}" both flatten to ${artifact.path} for Antigravity`);
    ruleSources.set(artifact.path, rule.name);
    artifacts.push(artifact);
  }

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
