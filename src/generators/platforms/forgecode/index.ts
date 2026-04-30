import { join } from "node:path";

import { enabledAgentsFor } from "../../../parsers/agent.js";
import { enabledRulesFor } from "../../../parsers/rule.js";
import { enabledSkillsFor } from "../../../parsers/skill.js";
import { PLATFORM_DIRS } from "../../../platforms.js";
import { buildRulesIndex } from "../../shared/rules-index.js";
import type { FileArtifact, GenerationResult, ProjectBundle } from "../../types.js";
import { buildForgecodeAgentArtifact } from "./agents.js";
import { buildForgecodeMcpArtifact } from "./mcp.js";
import { buildForgecodeSkillDirs } from "./skills.js";

export function generateForgecode(project: ProjectBundle): GenerationResult {
  const artifacts: FileArtifact[] = [];

  for (const agent of enabledAgentsFor(project.agents, "forgecode")) {
    artifacts.push(buildForgecodeAgentArtifact(agent));
  }

  artifacts.push(buildForgecodeMcpArtifact(project.mcp));

  const unsupportedPlatformRules = project.ulisConfig.unsupportedPlatformRules ?? "inject";
  const appendAfterRaw: { path: string; content: string }[] = [];
  if (unsupportedPlatformRules === "inject") {
    const result = buildRulesIndex(enabledRulesFor(project.rules, "forgecode"), {
      sourceDir: project.sourceDir,
      artifactPrefix: join(".forge", "rules"),
      indexPath: "AGENTS.md",
      referencePrefix: join("~", PLATFORM_DIRS.forgecode.home, "rules"),
    });
    if (result) {
      artifacts.push(...result.artifacts);
      appendAfterRaw.push(result.appendEntry);
    }
  }

  return {
    artifacts,
    post: {
      rawDirs: [join(project.sourceDir, "raw", "common"), join(project.sourceDir, "raw", "forgecode")],
      aliasFiles: [],
      skillDirs: buildForgecodeSkillDirs(enabledSkillsFor(project.skills, "forgecode")),
      skillsDestRelative: join(".forge", "skills"),
      appendAfterRaw,
    },
  };
}
