import { join, resolve } from "node:path";

import { ULIS_GENERATED_DIRNAME } from "./config.js";
import { formatDiagnostic } from "./diagnostics.js";
import { generate, writeResult } from "./generators/index.js";
import { ParseAggregateError, ParseError, parseProject } from "./parsers/index.js";
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

export interface TargetOptionInput {
  readonly target?: string | string[];
  readonly targets?: string | string[];
}

export interface AnalyzeProjectOptions {
  /**
   * Path to the ulis source tree (e.g. `./.ulis/` or `~/.ulis/` or a fixture path).
   * Required.
   */
  readonly sourceDir: string;
  readonly logger?: Logger;
  /** Resolved presets to merge into the project before validating. Applied in order; base wins. */
  readonly presets?: readonly ResolvedPreset[];
}

export interface AnalyzePresetsOptions {
  readonly logger?: Logger;
  /** Resolved presets to merge without a base source. Applied in order; later presets win conflicts. */
  readonly presets: readonly ResolvedPreset[];
}

export interface ProjectAnalysis {
  readonly project: ParsedProject;
  readonly diagnostics: readonly Diagnostic[];
  readonly errorCount: number;
  readonly warningCount: number;
}

export interface BuildResult {
  readonly targets: readonly Platform[];
  readonly sourceDir: string;
  readonly outputDir: string;
}

type ParsedProject = ReturnType<typeof parseProject>;

function reportParseErrors(err: ParseAggregateError, logger: Logger): never {
  for (const e of err.errors) logger.error(formatDiagnostic(e.toDiagnostic()));
  throw new Error(`Parsing failed: ${err.errors.length} error(s). No files written.`);
}

function validateAndReport(parsed: ParsedProject, logger: Logger): ProjectAnalysis {
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
    const line = formatDiagnostic(diagnostic);
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

  return { project: parsed, diagnostics, errorCount, warningCount };
}

/**
 * Parse and validate a source tree without writing generated files.
 */
export function analyzeProject(options: AnalyzeProjectOptions): ProjectAnalysis {
  const logger = options.logger ?? defaultLogger;
  const sourceDir = resolve(options.sourceDir);

  logger.header("Parsing");

  const presets = options.presets ?? [];
  if (presets.length > 0) {
    logger.info(`Presets: ${presets.map((p) => p.name).join(", ")}`);
  }

  let parsed: ParsedProject;
  try {
    if (presets.length === 0) {
      parsed = parseProject(sourceDir, { source: "base" });
    } else {
      const parseErrors: ParseError[] = [];
      const parseWithErrors = (dir: string, source: string): ParsedProject | undefined => {
        try {
          return parseProject(dir, { source });
        } catch (err) {
          if (err instanceof ParseAggregateError) {
            parseErrors.push(...err.errors);
            return undefined;
          }
          throw err;
        }
      };
      const presetProjects = presets.map((preset) => {
        logger.dim(`  Parsing preset: ${preset.name}`);
        return parseWithErrors(preset.dir, `preset:${preset.name}`);
      });
      const baseProject = parseWithErrors(sourceDir, "base");
      const completePresetProjects = presetProjects.filter((project): project is ParsedProject => project != null);
      if (parseErrors.length > 0) throw new ParseAggregateError(parseErrors);
      if (!baseProject || completePresetProjects.length !== presetProjects.length) {
        throw new Error("Parsing failed before project merge.");
      }
      parsed = mergeProjects([...completePresetProjects, baseProject]);
    }
  } catch (err) {
    if (err instanceof ParseAggregateError) {
      reportParseErrors(err, logger);
    }
    throw err;
  }
  return validateAndReport(parsed, logger);
}

/**
 * Parse and validate selected presets as an installable source without a base tree.
 */
export function analyzePresets(options: AnalyzePresetsOptions): ProjectAnalysis {
  const logger = options.logger ?? defaultLogger;
  const presets = options.presets;
  if (presets.length === 0) {
    throw new Error("Select at least one preset.");
  }

  logger.header("Parsing");
  logger.info(`Presets: ${presets.map((p) => p.name).join(", ")}`);

  let parsed: ParsedProject;
  try {
    const parseErrors: ParseError[] = [];
    const presetProjects = presets.map((preset) => {
      logger.dim(`  Parsing preset: ${preset.name}`);
      try {
        return parseProject(resolve(preset.dir), { source: `preset:${preset.name}` });
      } catch (err) {
        if (err instanceof ParseAggregateError) {
          parseErrors.push(...err.errors);
          return undefined;
        }
        throw err;
      }
    });
    const completePresetProjects = presetProjects.filter((project): project is ParsedProject => project != null);
    if (parseErrors.length > 0) throw new ParseAggregateError(parseErrors);
    if (completePresetProjects.length !== presetProjects.length) {
      throw new Error("Parsing failed before preset merge.");
    }
    parsed = mergeProjects(completePresetProjects);
  } catch (err) {
    if (err instanceof ParseAggregateError) {
      reportParseErrors(err, logger);
    }
    throw err;
  }
  return validateAndReport(parsed, logger);
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

  const analysis = analyzeProject({ sourceDir, logger, presets: options.presets });

  for (const target of activeTargets) {
    const outDir = join(outputDir, target);
    const result = generate(target, analysis.project);
    if (!result) throw new Error(`No generator registered for platform: ${target}`);
    writeResult(result, outDir, target, logger);
  }

  logger.header("Build Complete");
  logger.success(`Generated configs for: ${activeTargets.join(", ")}`);
  return { targets: activeTargets, sourceDir, outputDir };
}
