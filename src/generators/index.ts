import type { Platform } from "../platforms.js";
import { generateClaude } from "./platforms/claude.js";
import { generateCodex } from "./platforms/codex.js";
import { generateCursor } from "./platforms/cursor.js";
import { generateForgecode } from "./platforms/forgecode.js";
import { generateOpencode } from "./platforms/opencode.js";
import type { GenerationResult, ProjectBundle } from "./types.js";

export type { FileArtifact, GenerationResult, PostEmit, ProjectBundle } from "./types.js";
export { writeResult } from "./writer.js";

/**
 * Platforms that have been migrated to the pure `GenerationResult` pipeline.
 * Others still route through their legacy `generateXxx(...)` functions in
 * `build.ts`; entries are removed from this map as each platform is ported.
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
 *
 * Returns `undefined` for platforms that haven't been migrated yet; callers
 * should fall back to the legacy `generateXxx` path in that case.
 */
export function generate(platform: Platform, project: ProjectBundle): GenerationResult | undefined {
  const fn = GENERATORS[platform];
  return fn ? fn(project) : undefined;
}

/** True if this platform has been migrated off the legacy pipeline. */
export function hasNewGenerator(platform: Platform): boolean {
  return platform in GENERATORS;
}
