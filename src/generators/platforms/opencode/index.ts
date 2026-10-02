import { join } from "node:path";

import { enabledAgentsFor } from "../../../parsers/agent.js";
import { enabledRulesFor } from "../../../parsers/rule.js";
import { enabledSkillsFor } from "../../../parsers/skill.js";
import { PLATFORM_DIRS, resolvePlatformDirSegment } from "../../../platforms.js";
import { fileExists } from "../../../utils/fs.js";
import { buildRulesIndex } from "../../shared/rules-index.js";
import { rawDirs, sourceDirs } from "../../source-dirs.js";
import type { FileArtifact, GenerationResult, ProjectBundle } from "../../types.js";
import { buildOpencodeAgentBodyArtifact } from "./agents.js";
import { buildOpencodeCommandArtifacts } from "./commands.js";
import { buildOpencodeJson } from "./config.js";
import { buildOpencodeSkillDirs } from "./skills.js";

export function generateOpencode(project: ProjectBundle): GenerationResult {
  const artifacts: FileArtifact[] = [];

  const enabledAgents = enabledAgentsFor(project.agents, "opencode");
  const enabledSkills = enabledSkillsFor(project.skills, "opencode");

  artifacts.push({ path: "opencode.json", contents: buildOpencodeJson(project, enabledAgents) });

  for (const agent of enabledAgents) {
    artifacts.push(buildOpencodeAgentBodyArtifact(agent));
  }

  for (const sourceDir of sourceDirs(project)) {
    artifacts.push(...buildOpencodeCommandArtifacts(sourceDir));
  }
  artifacts.push({ path: "settings.json", contents: "{}" });

  const unsupportedPlatformRules = project.ulisConfig.unsupportedPlatformRules ?? "inject";
  const appendAfterRaw: { path: string; content: string }[] = [];
  if (unsupportedPlatformRules === "inject") {
    const result = buildRulesIndex(enabledRulesFor(project.rules, "opencode"), {
      artifactPrefix: "rules",
      indexPath: "AGENTS.md",
      referencePrefix: join("~", resolvePlatformDirSegment(PLATFORM_DIRS.opencode.home), "rules"),
    });
    if (result) {
      artifacts.push(...result.artifacts);
      appendAfterRaw.push(result.appendEntry);
    }
  }

  const copyDirs = sourceDirs(project)
    .map((sourceDir) => join(sourceDir, "docs"))
    .filter(fileExists)
    .map((src) => ({ src, destRelative: "docs" }));

  return {
    artifacts,
    post: {
      rawDirs: rawDirs(project, "opencode"),
      aliasFiles: [],
      skillDirs: buildOpencodeSkillDirs(enabledSkills),
      appendAfterRaw,
      copyDirs,
    },
  };
}
