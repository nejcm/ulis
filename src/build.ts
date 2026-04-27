import { join, resolve } from "node:path";

import { ULIS_GENERATED_DIRNAME } from "./config.js";
import { generate, writeResult } from "./generators/index.js";
import { ParseAggregateError, parseProject } from "./parsers/index.js";
import type { Platform } from "./platforms.js";
import { PLATFORMS, uniquePlatforms } from "./platforms.js";
import type { Diagnostic } from "./types.js";
import { logger as defaultLogger } from "./utils/logger.js";
import { mergeProjects } from "./utils/merge-projects.js";
import type { ResolvedPreset } from "./utils/resolve-presets.js";
import { validateCollisions } from "./validators/collisions.js";
import { validateCrossRefs } from "./validators/cross-refs.js";

export interface Logger {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  dim(message: string): void;
  header(message: string): void;
}

export interface BuildOptions {
  readonly targets?: readonly Platform[];
  /**
   * Path to the ulis source tree (e.g. `./.ulis/` or `~/.ulis/` or a fixture path).
   * Required.
   */
  readonly sourceDir: string;
  /**
   * Directory to write generated per-platform subtrees into.
   * Defaults to `<sourceDir>/generated`.
   */
  readonly outputDir?: string;
  readonly logger?: Logger;
  /** Resolved presets to merge into the project before building. Applied in order; base wins. */
  readonly presets?: readonly ResolvedPreset[];
}

export interface BuildResult {
  readonly targets: readonly Platform[];
  readonly sourceDir: string;
  readonly outputDir: string;
}

/**
 * Parse, validate, and generate all requested platform outputs.
 */
export function runBuild(options: BuildOptions): BuildResult {
  const logger = options.logger ?? defaultLogger;
  const sourceDir = resolve(options.sourceDir);
  const outputDir = resolve(options.outputDir ?? join(sourceDir, ULIS_GENERATED_DIRNAME));
  const activeTargets = options.targets ? uniquePlatforms(options.targets) : [...PLATFORMS];

  logger.header("ULIS Build");
  logger.info(`Source: ${sourceDir}`);
  logger.info(`Output: ${outputDir}`);
  logger.info(`Targets: ${activeTargets.join(", ")}`);

  logger.header("Parsing");

  const presets = options.presets ?? [];
  if (presets.length > 0) {
    logger.info(`Presets: ${presets.map((p) => p.name).join(", ")}`);
  }

  let parsed: ReturnType<typeof parseProject>;
  try {
    if (presets.length === 0) {
      parsed = parseProject(sourceDir);
    } else {
      const presetProjects = presets.map((preset) => {
        logger.dim(`  Parsing preset: ${preset.name}`);
        return parseProject(preset.dir);
      });
      const baseProject = parseProject(sourceDir);
      parsed = mergeProjects([...presetProjects, baseProject]);
    }
  } catch (err) {
    if (err instanceof ParseAggregateError) {
      for (const e of err.errors) logger.error(e.message);
      throw new Error(`Parsing failed: ${err.errors.length} error(s). No files written.`);
    }
    throw err;
  }
  logger.success(`Parsed ${parsed.agents.length} agents`);
  logger.success(`Parsed ${parsed.skills.length} skills`);
  if (parsed.rules.length > 0) logger.success(`Parsed ${parsed.rules.length} rules`);
  logger.success(`Parsed ${Object.keys(parsed.mcp.servers).length} MCP servers`);

  logger.header("Validation");
  const diagnostics: readonly Diagnostic[] = [
    ...validateCrossRefs(parsed.agents, parsed.skills, parsed.mcp),
    ...validateCollisions(parsed.agents, parsed.skills),
  ];

  for (const diagnostic of diagnostics) {
    const line = `[${diagnostic.entity}] ${diagnostic.message}${
      diagnostic.suggestion ? ` - ${diagnostic.suggestion}` : ""
    }`;
    if (diagnostic.level === "error") {
      logger.error(line);
    } else {
      logger.warn(line);
    }
  }

  const errorCount = diagnostics.filter((diagnostic) => diagnostic.level === "error").length;
  const warningCount = diagnostics.length - errorCount;
  if (errorCount > 0) {
    throw new Error(`Validation failed: ${errorCount} error(s), ${warningCount} warning(s). No files written.`);
  }
  logger.success(`Validation passed (${warningCount} warning(s))`);

  for (const target of activeTargets) {
    const outDir = join(outputDir, target);
    const result = generate(target, parsed);
    if (!result) throw new Error(`No generator registered for platform: ${target}`);
    writeResult(result, outDir, target);
  }

  logger.header("Build Complete");
  logger.success(`Generated configs for: ${activeTargets.join(", ")}`);
  return { targets: activeTargets, sourceDir, outputDir };
}
