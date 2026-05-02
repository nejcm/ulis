import { join } from "node:path";

import { parseCommands } from "../../../parsers/command.js";
import { fileExists } from "../../../utils/fs.js";
import { serializeYamlFrontmatter } from "../../shared/yaml";
import type { FileArtifact } from "../../types.js";

export function buildClaudeCommandArtifacts(sourceDir: string): FileArtifact[] {
  const artifacts: FileArtifact[] = [];
  const commandsSrc = join(sourceDir, "commands");
  if (!fileExists(commandsSrc)) return artifacts;

  for (const cmd of parseCommands(commandsSrc)) {
    const fm = cmd.frontmatter as Record<string, unknown>;
    const claudePlatform = (fm.platforms as Record<string, unknown> | undefined)?.claude as
      | Record<string, unknown>
      | undefined;
    const { enabled: _e, model: _cm, ...claudeExtra } = claudePlatform ?? {};
    const resolvedModel = (claudePlatform?.model ?? fm.model) as string | undefined;

    const { platforms: _platforms, model: _model, ...rest } = fm;
    const outData: Record<string, unknown> = { ...rest, ...claudeExtra };
    if (resolvedModel) outData.model = resolvedModel;

    artifacts.push({
      path: join("commands", cmd.filename),
      contents: `${serializeYamlFrontmatter(outData)}\n\n${cmd.body}\n`,
    });
  }

  return artifacts;
}
