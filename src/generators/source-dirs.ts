import { join } from "node:path";

import type { ProjectBundle } from "./types.js";

export function sourceDirs(project: ProjectBundle): readonly string[] {
  return project.sourceDirs ?? [project.sourceDir];
}

export function rawDirs(project: ProjectBundle, platform: string): readonly string[] {
  return sourceDirs(project).flatMap((sourceDir) => [join(sourceDir, "raw", "all"), join(sourceDir, "raw", platform)]);
}
