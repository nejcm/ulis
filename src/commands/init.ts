import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { ULIS_GENERATED_DIRNAME, ULIS_SOURCE_DIRNAME } from "../config.js";
import {
  DEFAULT_SCHEMA_BASE,
  renderConfig,
  renderGuardrails,
  renderMcp,
  renderPermissions,
  renderPlugins,
  renderSkills,
  type ScaffoldContext,
} from "../scaffold/index.js";
import { log } from "../utils/logger.js";

export interface InitOptions {
  readonly global?: boolean;
}

const SUBDIRS = ["agents", "skills", "commands", "raw"] as const;

export async function initCmd(options: InitOptions = {}): Promise<void> {
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

  log.header(`ulis init ${options.global ? "(global)" : "(project)"}`);
  log.info(`Target: ${targetDir}`);

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
  writeFileSync(join(targetDir, "guardrails.md"), renderGuardrails(context));

  log.success(`Scaffolded ${targetDir}`);

  if (!options.global) {
    appendGitignore(cwd);
    log.info("");
    log.info("Next steps:");
    log.dim(`  - Add agents to ${ULIS_SOURCE_DIRNAME}/agents/*.md`);
    log.dim(`  - Declare MCP servers in ${ULIS_SOURCE_DIRNAME}/mcp.yaml`);
    log.dim(`  - Run 'ulis install' to generate and install platform configs`);
    log.info("");
    log.dim("Tip: consider adding .claude/, .cursor/, .codex/, .opencode/, .forge/, and .mcp.json to .gitignore");
    log.dim("     if you don't want to commit generated configs.");
  } else {
    log.info("");
    log.info("Next steps:");
    log.dim(`  - Add agents to ~/${ULIS_SOURCE_DIRNAME}/agents/*.md`);
    log.dim(`  - Run 'ulis install --global' to generate and install to ~/.claude/, ~/.codex/, etc.`);
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

function appendGitignore(cwd: string): void {
  const ignorePath = join(cwd, ".gitignore");
  const entry = `/${ULIS_SOURCE_DIRNAME}/${ULIS_GENERATED_DIRNAME}/`;

  let content = "";
  if (existsSync(ignorePath)) {
    content = readFileSync(ignorePath, "utf8");
    const lines = content.split(/\r?\n/);
    if (lines.some((line) => line.trim() === entry || line.trim() === entry.slice(1))) {
      log.dim(`.gitignore already contains ${entry}`);
      return;
    }
    if (!content.endsWith("\n")) content += "\n";
  }
  content += `\n# ulis build output\n${entry}\n`;
  writeFileSync(ignorePath, content);
  log.success(`Updated .gitignore (${entry})`);
}
