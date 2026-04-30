import { join } from "node:path";

import { enabledAgentsFor } from "../../../parsers/agent.js";
import { enabledRulesFor } from "../../../parsers/rule.js";
import { enabledSkillsFor } from "../../../parsers/skill.js";
import { PLATFORM_DIRS } from "../../../platforms.js";
import { fileExists } from "../../../utils/fs.js";
import { buildRulesIndex } from "../../shared/rules-index.js";
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

  artifacts.push(...buildOpencodeCommandArtifacts(project.sourceDir));
  artifacts.push({ path: "settings.json", contents: "{}" });

  const unsupportedPlatformRules = project.ulisConfig.unsupportedPlatformRules ?? "inject";
  const appendAfterRaw: { path: string; content: string }[] = [];
  if (unsupportedPlatformRules === "inject") {
    const result = buildRulesIndex(enabledRulesFor(project.rules, "opencode"), {
      sourceDir: project.sourceDir,
      artifactPrefix: "rules",
      indexPath: "AGENTS.md",
      referencePrefix: join("~", PLATFORM_DIRS.opencode.home, "rules"),
    });
    if (result) {
      artifacts.push(...result.artifacts);
      appendAfterRaw.push(result.appendEntry);
    }
  }

  const docsSrc = join(project.sourceDir, "docs");
  const copyDirs = fileExists(docsSrc) ? [{ src: docsSrc, destRelative: "docs" }] : [];

  return {
    artifacts,
    post: {
      rawDirs: [join(project.sourceDir, "raw", "common"), join(project.sourceDir, "raw", "opencode")],
      aliasFiles: [],
      skillDirs: buildOpencodeSkillDirs(enabledSkills),
      appendAfterRaw,
      copyDirs,
    },
  };
}
