import { join, resolve } from "node:path";

import { ULIS_GENERATED_DIRNAME } from "./config.js";
import { generateClaude } from "./generators/claude.js";
import { generateCodex } from "./generators/codex.js";
import { generateCursor } from "./generators/cursor.js";
import { generateForgecode } from "./generators/forgecode.js";
import { generateOpencode } from "./generators/opencode.js";
import { parseAgents } from "./parsers/agent.js";
import { loadMcp } from "./parsers/mcp.js";
import { loadPermissions } from "./parsers/permissions.js";
import { loadPlugins } from "./parsers/plugins.js";
import { parseSkills } from "./parsers/skill.js";
import type { Platform } from "./platforms.js";
import { PLATFORMS, uniquePlatforms } from "./platforms.js";
import { loadBuildConfig } from "./utils/build-config.js";
import { log } from "./utils/logger.js";
import { validateCollisions } from "./validators/collisions.js";
import { validateCrossRefs, type Diagnostic } from "./validators/cross-refs.js";

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
}

export interface BuildResult {
  readonly targets: readonly Platform[];
  readonly sourceDir: string;
  readonly outputDir: string;
}

export function runBuild(options: BuildOptions): BuildResult {
  const logger = options.logger ?? log;
  const sourceDir = resolve(options.sourceDir);
  const outputDir = resolve(options.outputDir ?? join(sourceDir, ULIS_GENERATED_DIRNAME));
  const activeTargets = options.targets ? uniquePlatforms(options.targets) : [...PLATFORMS];

  logger.header("ULIS Build");
  logger.info(`Source: ${sourceDir}`);
  logger.info(`Output: ${outputDir}`);
  logger.info(`Targets: ${activeTargets.join(", ")}`);

  logger.header("Parsing");
  const agents = parseAgents(join(sourceDir, "agents"));
  logger.success(`Parsed ${agents.length} agents`);

  const skills = parseSkills(join(sourceDir, "skills"));
  logger.success(`Parsed ${skills.length} skills`);

  const mcp = loadMcp(sourceDir);
  logger.success(`Parsed ${Object.keys(mcp.servers).length} MCP servers`);

  const plugins = loadPlugins(sourceDir);
  logger.success(`Parsed plugins config`);

  const buildConfig = loadBuildConfig(sourceDir);
  logger.success(`Loaded build config`);

  const permissions = loadPermissions(sourceDir);
  logger.success(`Loaded permissions config`);

  logger.header("Validation");
  const diagnostics: readonly Diagnostic[] = [
    ...validateCrossRefs(agents, skills, mcp),
    ...validateCollisions(agents, skills),
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
    switch (target) {
      case "opencode":
        generateOpencode(agents, skills, mcp, sourceDir, outDir, buildConfig, permissions);
        break;
      case "claude":
        generateClaude(agents, skills, mcp, plugins, sourceDir, outDir, buildConfig, permissions);
        break;
      case "codex":
        generateCodex(agents, skills, mcp, sourceDir, outDir, buildConfig, permissions);
        break;
      case "cursor":
        generateCursor(agents, skills, mcp, sourceDir, outDir, buildConfig, permissions);
        break;
      case "forgecode":
        generateForgecode(agents, skills, mcp, sourceDir, outDir, buildConfig);
        break;
    }
  }

  logger.header("Build Complete");
  logger.success(`Generated configs for: ${activeTargets.join(", ")}`);
  return { targets: activeTargets, sourceDir, outputDir };
}
