import type { Platform } from "../platforms.js";
import { generateClaude } from "./platforms/claude/index.js";
import { generateCodex } from "./platforms/codex/index.js";
import { generateCursor } from "./platforms/cursor/index.js";
import { generateForgecode } from "./platforms/forgecode/index.js";
import { generateOpencode } from "./platforms/opencode/index.js";
import type { GenerationResult, ProjectBundle } from "./types.js";

export type { FileArtifact, GenerationResult, PostEmit, ProjectBundle } from "./types.js";
export { writeResult } from "./writer.js";

/**
 * Registered platform generators for the pure `GenerationResult` pipeline.
 */
const GENERATORS: Partial<Record<Platform, (p: ProjectBundle) => GenerationResult>> = {
  claude: generateClaude,
  codex: generateCodex,
  cursor: generateCursor,
  forgecode: generateForgecode,
  opencode: generateOpencode,
};

/**
 * Run the generator for one platform over a parsed project. Returns a pure
 * `GenerationResult` — no filesystem side effects. Use `writeResult` to apply.
 */
export function generate(platform: Platform, project: ProjectBundle): GenerationResult | undefined {
  const fn = GENERATORS[platform];
  return fn ? fn(project) : undefined;
}

/** True if this platform has been migrated off the legacy pipeline. */
export function hasNewGenerator(platform: Platform): boolean {
  return platform in GENERATORS;
}
