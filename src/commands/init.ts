import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import type { Logger } from "../build.js";
import { ULIS_GENERATED_DIRNAME, ULIS_SOURCE_DIRNAME } from "../config.js";
import {
  DEFAULT_SCHEMA_BASE,
  renderConfig,
  renderMcp,
  renderPermissions,
  renderPlugins,
  renderRuleCodeStyle,
  renderSkills,
  type ScaffoldContext,
} from "../scaffold/index.js";
import { logger as log } from "../utils/logger.js";

export interface InitOptions {
  readonly global?: boolean;
  readonly logger?: Logger;
}

const SUBDIRS = ["agents", "skills", "commands", "raw", "rules"] as const;

/**
 * Scaffold a new `.ulis` source tree in project or global mode.
 */
export async function initCmd(options: InitOptions = {}): Promise<void> {
  const logger = options.logger ?? log;
  const cwd = process.cwd();
  const targetRoot = options.global ? homedir() : cwd;
  const targetDir = join(targetRoot, ULIS_SOURCE_DIRNAME);

  if (existsSync(targetDir)) {
    throw new Error(`${targetDir} already exists. Aborting.`);
  }

  const name = options.global ? "global" : (readProjectName(cwd) ?? basename(cwd));
  const context: ScaffoldContext = {
    name,
    schemaBase: DEFAULT_SCHEMA_BASE,
  };

  logger.header(`ulis init ${options.global ? "(global)" : "(project)"}`);
  logger.info(`Target: ${targetDir}`);

  mkdirSync(targetDir, { recursive: true });
  for (const sub of SUBDIRS) {
    mkdirSync(join(targetDir, sub), { recursive: true });
    // Keep empty folders in git for project mode
    if (!options.global) {
      writeFileSync(join(targetDir, sub, ".gitkeep"), "");
    }
  }

  writeFileSync(join(targetDir, "config.yaml"), renderConfig(context));
  writeFileSync(join(targetDir, "mcp.yaml"), renderMcp(context));
  writeFileSync(join(targetDir, "permissions.yaml"), renderPermissions(context));
  writeFileSync(join(targetDir, "plugins.yaml"), renderPlugins(context));
  writeFileSync(join(targetDir, "skills.yaml"), renderSkills(context));
  writeFileSync(join(targetDir, "rules", "code-style.md"), renderRuleCodeStyle(context));

  logger.success(`Scaffolded ${targetDir}`);

  if (!options.global) {
    appendGitignore(cwd, logger);
    logger.info("");
    logger.info("Next steps:");
    logger.dim(`  - Add agents to ${ULIS_SOURCE_DIRNAME}/agents/*.md`);
    logger.dim(`  - Declare MCP servers in ${ULIS_SOURCE_DIRNAME}/mcp.yaml`);
    logger.dim(`  - Run 'ulis install' to generate and install platform configs`);
    logger.info("");
    logger.dim("Tip: consider adding .claude/, .cursor/, .codex/, .opencode/, .forge/ to .gitignore");
    logger.dim("     if you don't want to commit generated configs.");
  } else {
    logger.info("");
    logger.info("Next steps:");
    logger.dim(`  - Add agents to ~/${ULIS_SOURCE_DIRNAME}/agents/*.md`);
    logger.dim(`  - Run 'ulis install --global' to generate and install to ~/.claude/, ~/.codex/, etc.`);
  }
}

function readProjectName(cwd: string): string | undefined {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
    return pkg.name;
  } catch {
    return undefined;
  }
}

function appendGitignore(cwd: string, logger: Logger = log): void {
  const ignorePath = join(cwd, ".gitignore");
  const entry = `/${ULIS_SOURCE_DIRNAME}/${ULIS_GENERATED_DIRNAME}/`;

  let content = "";
  if (existsSync(ignorePath)) {
    content = readFileSync(ignorePath, "utf8");
    const lines = content.split(/\r?\n/);
    if (lines.some((line) => line.trim() === entry || line.trim() === entry.slice(1))) {
      logger.dim(`.gitignore already contains ${entry}`);
      return;
    }
    if (!content.endsWith("\n")) content += "\n";
  }
  content += `\n# ulis build output\n${entry}\n`;
  writeFileSync(ignorePath, content);
  logger.success(`Updated .gitignore (${entry})`);
}
