import { join } from "node:path";

import type { ParsedSkill } from "../../../parsers/skill.js";
import { fileExists, readFile } from "../../../utils/fs.js";
import { toPlatformSkillMarkdown } from "../../../utils/skill-frontmatter.js";
import { extraToYamlLines } from "../../shared/yaml.js";
import type { FileArtifact } from "../../types.js";
import { toYamlString } from "./format.js";

export function buildCodexSkillArtifacts(skill: ParsedSkill): FileArtifact[] {
  const artifacts: FileArtifact[] = [];
  const skillName = skill.frontmatter?.name ?? skill.name;
  const fm = skill.frontmatter;
  const codexPlatform = fm?.platforms?.codex;

  // Destructure known/specially-handled fields; everything else passes through.
  const {
    enabled: _enabled,
    model: _model,
    displayName: _displayName,
    shortDescription: _shortDescription,
    iconSmall: _iconSmall,
    iconLarge: _iconLarge,
    brandColor: _brandColor,
    defaultPrompt: _defaultPrompt,
    mcpDependencies: _mcpDependencies,
    ...codexSkillExtra
  } = (codexPlatform ?? {}) as Record<string, unknown>;

  const skillMdPath = join(skill.dir, "SKILL.md");
  if (!fileExists(skillMdPath)) {
    return artifacts;
  }
  const rawSkillMd = readFile(skillMdPath);
  artifacts.push({
    path: join("skills", skill.name, "SKILL.md"),
    contents: toPlatformSkillMarkdown(rawSkillMd) + "\n",
  });

  const hasUiConfig =
    codexPlatform?.displayName ||
    codexPlatform?.shortDescription ||
    codexPlatform?.iconSmall ||
    codexPlatform?.iconLarge ||
    codexPlatform?.brandColor ||
    codexPlatform?.defaultPrompt;
  const hasDeps = codexPlatform?.mcpDependencies?.length;
  const hasModel = !!codexPlatform?.model;
  const hasExtra = Object.keys(codexSkillExtra).length > 0;
  const needsYaml = hasUiConfig || hasDeps || hasModel || hasExtra || !fm?.allowImplicitInvocation;

  if (needsYaml) {
    const yamlLines: string[] = [];

    if (codexPlatform?.model) {
      yamlLines.push(`model: ${toYamlString(codexPlatform.model)}`);
      yamlLines.push("");
    }

    if (hasUiConfig) {
      yamlLines.push("interface:");
      yamlLines.push(`  display_name: ${toYamlString(codexPlatform?.displayName ?? skillName)}`);
      if (codexPlatform?.shortDescription)
        yamlLines.push(`  short_description: ${toYamlString(codexPlatform.shortDescription)}`);
      if (codexPlatform?.iconSmall) yamlLines.push(`  icon_small: ${toYamlString(codexPlatform.iconSmall)}`);
      if (codexPlatform?.iconLarge) yamlLines.push(`  icon_large: ${toYamlString(codexPlatform.iconLarge)}`);
      if (codexPlatform?.brandColor) yamlLines.push(`  brand_color: ${toYamlString(codexPlatform.brandColor)}`);
      if (codexPlatform?.defaultPrompt) {
        yamlLines.push(`  default_prompt: ${toYamlString(codexPlatform.defaultPrompt)}`);
      }
      yamlLines.push("");
    }

    yamlLines.push("policy:");
    yamlLines.push(`  allow_implicit_invocation: ${fm?.allowImplicitInvocation}`);
    yamlLines.push("");

    if (hasDeps) {
      yamlLines.push("dependencies:");
      yamlLines.push("  tools:");
      for (const dep of codexPlatform!.mcpDependencies!) {
        yamlLines.push(`    - type: ${dep.type}`);
        yamlLines.push(`      value: ${toYamlString(dep.value)}`);
        if (dep.description) yamlLines.push(`      description: ${toYamlString(dep.description)}`);
        if (dep.transport) yamlLines.push(`      transport: ${toYamlString(dep.transport)}`);
        if (dep.url) yamlLines.push(`      url: ${toYamlString(dep.url)}`);
      }
    }

    yamlLines.push(...extraToYamlLines(codexSkillExtra));

    artifacts.push({
      path: join("skills", skill.name, "agents", "openai.yaml"),
      contents: yamlLines.join("\n") + "\n",
    });
  }

  return artifacts;
}
