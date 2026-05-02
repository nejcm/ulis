import { join } from "node:path";

import { parseCommands } from "../../../parsers/command.js";
import { fileExists, readFile } from "../../../utils/fs.js";
import { serializeYamlFrontmatter } from "../../shared/yaml";
import type { FileArtifact } from "../../types.js";

export function buildOpencodeCommandArtifacts(sourceDir: string): FileArtifact[] {
  const artifacts: FileArtifact[] = [];
  const commandsSrc = join(sourceDir, "commands");
  if (!fileExists(commandsSrc)) return artifacts;

  for (const cmd of parseCommands(commandsSrc)) {
    const fm = cmd.frontmatter as Record<string, unknown>;
    const ocPlatform = (fm.platforms as Record<string, unknown> | undefined)?.opencode as
      | Record<string, unknown>
      | undefined;
    const resolvedModel = (ocPlatform?.model ?? fm.model) as string | undefined;
    const resolvedAgent = (ocPlatform?.agent ?? fm.agent) as string | undefined;
    const resolvedSubtask = (ocPlatform?.subtask ?? fm.subtask) as boolean | undefined;

    const { enabled: _e, model: _ocm, agent: _oca, subtask: _ocs, ...ocExtra } = ocPlatform ?? {};
    const { platforms: _platforms, model: _model, agent: _agent, subtask: _subtask, ...rest } = fm;
    const outData: Record<string, unknown> = { ...rest, ...ocExtra };
    if (resolvedModel) outData.model = resolvedModel;
    if (resolvedAgent) outData.agent = resolvedAgent;
    if (resolvedSubtask !== undefined) outData.subtask = resolvedSubtask;

    artifacts.push({
      path: join("commands", cmd.filename),
      contents: `${serializeYamlFrontmatter(outData)}\n\n${cmd.body}\n`,
    });
  }

  const readmeSrc = join(commandsSrc, "README.md");
  if (fileExists(readmeSrc)) {
    artifacts.push({ path: join("commands", "README.md"), contents: readFile(readmeSrc) });
  }

  return artifacts;
}
