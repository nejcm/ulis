import { join, resolve } from "node:path";

import { generateClaude } from "./generators/claude.js";
import { generateCodex } from "./generators/codex.js";
import { generateCursor } from "./generators/cursor.js";
import { generateOpencode } from "./generators/opencode.js";
import { parseAgents } from "./parsers/agent.js";
import { parseSkills } from "./parsers/skill.js";
import type { Platform } from "./platforms.js";
import { AI_GLOBAL_SOURCES_DIR } from "./config.js";
import { PLATFORMS, uniquePlatforms } from "./platforms.js";
import { McpConfigSchema, PluginsConfigSchema } from "./schema.js";
import { loadBuildConfig } from "./utils/build-config.js";
import { readFile } from "./utils/fs.js";
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
  readonly rootDir?: string;
  readonly logger?: Logger;
}

export function runBuild(options: BuildOptions = {}): readonly Platform[] {
  const logger = options.logger ?? log;
  const rootDir = options.rootDir ?? resolve(join(import.meta.dirname, ".."));
  const aiDir = resolve(join(rootDir, ".ai", AI_GLOBAL_SOURCES_DIR));
  const generatedDir = resolve(join(rootDir, "generated"));
  const activeTargets = options.targets ? uniquePlatforms(options.targets) : [...PLATFORMS];

  logger.header("AI Config Build System");
  logger.info(`Source: ${aiDir}`);
  logger.info(`Output: ${generatedDir}`);
  logger.info(`Targets: ${activeTargets.join(", ")}`);

  logger.header("Parsing");
  const agents = parseAgents(join(aiDir, "agents"));
  logger.success(`Parsed ${agents.length} agents`);

  const skills = parseSkills(join(aiDir, "skills"));
  logger.success(`Parsed ${skills.length} skills`);

  const mcp = McpConfigSchema.parse(JSON.parse(readFile(join(aiDir, "mcp.json"))));
  logger.success(`Parsed ${Object.keys(mcp.servers).length} MCP servers`);

  const plugins = PluginsConfigSchema.parse(JSON.parse(readFile(join(aiDir, "plugins.json"))));
  logger.success(`Parsed plugins config`);

  const buildConfig = loadBuildConfig(aiDir);
  logger.success(`Loaded build config`);

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
    const outDir = join(generatedDir, target);
    switch (target) {
      case "opencode":
        generateOpencode(agents, skills, mcp, aiDir, outDir, buildConfig);
        break;
      case "claude":
        generateClaude(agents, skills, mcp, plugins, aiDir, outDir, buildConfig);
        break;
      case "codex":
        generateCodex(agents, skills, mcp, aiDir, outDir, buildConfig);
        break;
      case "cursor":
        generateCursor(agents, skills, mcp, aiDir, outDir, buildConfig);
        break;
    }
  }

  logger.header("Build Complete");
  logger.success(`Generated configs for: ${activeTargets.join(", ")}`);
  return activeTargets;
}
