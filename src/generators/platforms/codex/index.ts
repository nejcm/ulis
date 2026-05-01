import { join } from "node:path";

import { enabledAgentsFor } from "../../../parsers/agent.js";
import { enabledRulesFor } from "../../../parsers/rule.js";
import { enabledSkillsFor } from "../../../parsers/skill.js";
import { PLATFORM_DIRS, resolvePlatformDirSegment } from "../../../platforms.js";
import { buildRulesIndex } from "../../shared/rules-index.js";
import type { FileArtifact, GenerationResult, ProjectBundle } from "../../types.js";
import { buildCodexAgentArtifact } from "./agents.js";
import { buildCodexConfigToml } from "./config.js";
import { buildCodexSkillArtifacts } from "./skills.js";

export function generateCodex(project: ProjectBundle): GenerationResult {
  const artifacts: FileArtifact[] = [];

  artifacts.push({ path: "config.toml", contents: buildCodexConfigToml(project) });

  for (const agent of enabledAgentsFor(project.agents, "codex")) {
    artifacts.push(buildCodexAgentArtifact(agent));
  }

  for (const skill of enabledSkillsFor(project.skills, "codex")) {
    artifacts.push(...buildCodexSkillArtifacts(skill));
  }

  const unsupportedPlatformRules = project.ulisConfig.unsupportedPlatformRules ?? "inject";
  const appendAfterRaw: { path: string; content: string }[] = [];
  if (unsupportedPlatformRules === "inject") {
    const result = buildRulesIndex(enabledRulesFor(project.rules, "codex"), {
      sourceDir: project.sourceDir,
      artifactPrefix: "rules",
      indexPath: "AGENTS.md",
      referencePrefix: join("~", resolvePlatformDirSegment(PLATFORM_DIRS.codex.home), "rules"),
    });
    if (result) {
      artifacts.push(...result.artifacts);
      appendAfterRaw.push(result.appendEntry);
    }
  }

  return {
    artifacts,
    post: {
      rawDirs: [join(project.sourceDir, "raw", "common"), join(project.sourceDir, "raw", "codex")],
      aliasFiles: [],
      skillDirs: [],
      appendAfterRaw,
    },
  };
}
