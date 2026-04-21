import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import { runBuild, type Logger } from "./build.js";
import { ULIS_GENERATED_DIRNAME } from "./config.js";
import { loadPlugins } from "./parsers/plugins.js";
import { loadSkills } from "./parsers/skills.js";
import { PLATFORM_DIRS, PLATFORM_LABELS, PLATFORMS, platformConfigDir, uniquePlatforms, type Platform } from "./platforms.js";
import { type PluginsConfig, type SkillsConfig } from "./schema.js";
import { deepMerge } from "./utils/build-config.js";

export interface InstallOptions {
  readonly platforms?: readonly Platform[];
  /**
   * ulis source tree (e.g. `./.ulis/` or `~/.ulis/`).
   */
  readonly sourceDir: string;
  /**
   * Where the per-platform configs land — typically `~` for global, CWD for project.
   */
  readonly destBase: string;
  /**
   * Where the intermediate build output lives. Defaults to `<sourceDir>/generated/`.
   */
  readonly outputDir?: string;
  readonly backup?: boolean;
  readonly rebuild?: boolean;
  readonly logger?: Logger;
}

export function loadDotEnv(rootDir: string, env: NodeJS.ProcessEnv = process.env): void {
  const envPath = join(rootDir, ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!key || key in env) {
      continue;
    }

    env[key] = rawValue.replace(/^['"]|['"]$/gu, "");
  }
}

export function runInstall(options: InstallOptions): readonly Platform[] {
  const logger = options.logger;
  const sourceDir = resolve(options.sourceDir);
  const destBase = resolve(options.destBase);
  const outputDir = resolve(options.outputDir ?? join(sourceDir, ULIS_GENERATED_DIRNAME));
  const platforms = options.platforms ? uniquePlatforms(options.platforms) : [...PLATFORMS];
  const backup = options.backup ?? false;
  const rebuild = options.rebuild ?? false;

  loadDotEnv(destBase);
  loadDotEnv(sourceDir);

  logHeader(logger, `ULIS Install (${process.platform === "win32" ? "Windows" : "Linux/macOS"})`);
  logInfo(logger, `Source: ${sourceDir}`);
  logInfo(logger, `Output (generated): ${outputDir}`);
  logInfo(logger, `Destination base: ${destBase}`);
  logInfo(logger, `Platforms: ${platforms.join(", ")}`);

  if (platforms.length === 0) {
    logWarn(logger, "No platforms selected. Nothing to install.");
    return [];
  }

  const missingBuildOutputs = platforms.some((platform) => !existsSync(join(outputDir, platform)));
  if (rebuild || missingBuildOutputs) {
    logWarn(
      logger,
      rebuild ? "Rebuilding generated configs before install." : "Missing generated output. Running build.",
    );
    runBuild({ targets: platforms, sourceDir, outputDir, logger });
  }

  const plugins = loadPlugins(sourceDir);
  const skillsConfig = loadSkills(sourceDir);

  const timestamp = makeTimestamp();
  for (const platform of platforms) {
    const context: InstallContext = { outputDir, destBase, backup, timestamp, plugins, skills: skillsConfig, logger };
    switch (platform) {
      case "opencode":
        installOpencode(context);
        break;
      case "claude":
        installClaude(context);
        break;
      case "codex":
        installCodex(context);
        break;
      case "cursor":
        installCursor(context);
        break;
      case "forgecode":
        installForgecode(context);
        break;
    }
  }

  const globalSkills = skillsConfig["*"]?.skills ?? [];
  if (globalSkills.length > 0) {
    logHeader(logger, "Installing Global Skills");
    installSkills(globalSkills, "*", logger);
  }

  logHeader(logger, "Installation Complete");
  return platforms;
}

interface InstallContext {
  readonly outputDir: string;
  readonly destBase: string;
  readonly backup: boolean;
  readonly timestamp: string;
  readonly plugins: PluginsConfig;
  readonly skills: SkillsConfig;
  readonly logger?: Logger;
}

function installOpencode(context: InstallContext): void {
  const targetDir = platformConfigDir("opencode", context.destBase);
  logHeader(context.logger, `Installing ${PLATFORM_LABELS.opencode}`);
  backupDirectory(targetDir, context);

  rmSync(targetDir, { recursive: true, force: true });
  cpSync(join(context.outputDir, "opencode"), targetDir, { recursive: true });
  logSuccess(context.logger, `OpenCode -> ${targetDir}`);

  const skills = context.skills.opencode?.skills ?? [];
  if (skills.length > 0) {
    installSkills(skills, "opencode", context.logger);
  }
}

function installClaude(context: InstallContext): void {
  const targetDir = platformConfigDir("claude", context.destBase);
  const sourceDir = join(context.outputDir, "claude");
  const generatedSettings = join(sourceDir, "settings.json");
  const targetSettings = join(targetDir, "settings.json");

  logHeader(context.logger, `Installing ${PLATFORM_LABELS.claude}`);
  backupDirectory(targetDir, context);
  ensureDir(targetDir);

  if (existsSync(generatedSettings)) {
    if (existsSync(targetSettings)) {
      const merged = mergeSettingsJson(targetSettings, generatedSettings);
      writeJson(targetSettings, merged);
      logSuccess(context.logger, "settings.json (merged)");
    } else {
      cpSync(generatedSettings, targetSettings);
      logSuccess(context.logger, "settings.json (copied)");
    }
  }

  copyPlatformContents(sourceDir, targetDir, context.logger, new Set(["settings.json"]));
  installClaudePlugins(context.plugins, context.logger);

  const claudeSkills = context.skills.claude?.skills ?? [];
  if (claudeSkills.length > 0) {
    installSkills(claudeSkills, "claude", context.logger);
  }
}

function installCodex(context: InstallContext): void {
  const targetDir = platformConfigDir("codex", context.destBase);
  logHeader(context.logger, `Installing ${PLATFORM_LABELS.codex}`);
  backupDirectory(targetDir, context);
  ensureDir(targetDir);
  copyPlatformContents(join(context.outputDir, "codex"), targetDir, context.logger);

  const skills = context.skills.codex?.skills ?? [];
  if (skills.length > 0) {
    installSkills(skills, "codex", context.logger);
  }
}

function installCursor(context: InstallContext): void {
  const targetDir = platformConfigDir("cursor", context.destBase);
  const sourceDir = join(context.outputDir, "cursor");
  const generatedMcp = join(sourceDir, "mcp.json");
  const targetMcp = join(targetDir, "mcp.json");

  logHeader(context.logger, `Installing ${PLATFORM_LABELS.cursor}`);
  backupDirectory(targetDir, context);
  ensureDir(targetDir);

  if (existsSync(generatedMcp)) {
    if (existsSync(targetMcp)) {
      const merged = mergeCursorMcpJson(targetMcp, generatedMcp);
      writeJson(targetMcp, merged);
      logSuccess(context.logger, "mcp.json (merged)");
    } else {
      cpSync(generatedMcp, targetMcp);
      logSuccess(context.logger, "mcp.json (copied)");
    }
  }

  copyPlatformContents(sourceDir, targetDir, context.logger, new Set(["mcp.json"]));

  const skills = context.skills.cursor?.skills ?? [];
  if (skills.length > 0) {
    installSkills(skills, "cursor", context.logger);
  }
}

function installForgecode(context: InstallContext): void {
  const sourceDir = join(context.outputDir, "forgecode");
  const sourceForgeDir = join(sourceDir, PLATFORM_DIRS.forgecode.project);
  const sourceMcp = join(sourceDir, ".mcp.json");
  const targetForgeDir = platformConfigDir("forgecode", context.destBase);
  const targetMcp = join(context.destBase, ".mcp.json");

  logHeader(context.logger, `Installing ${PLATFORM_LABELS.forgecode}`);
  backupDirectory(targetForgeDir, context);
  backupFile(targetMcp, context);
  ensureDir(targetForgeDir);

  if (existsSync(sourceForgeDir)) {
    copyPlatformContents(sourceForgeDir, targetForgeDir, context.logger);
  }

  // Project installs can place AGENTS.md and other top-level artifacts in repo root.
  if (context.destBase !== homedir()) {
    copyPlatformContents(sourceDir, context.destBase, context.logger, new Set([PLATFORM_DIRS.forgecode.project, ".mcp.json"]));
  }

  if (existsSync(sourceMcp)) {
    if (existsSync(targetMcp)) {
      const merged = mergeCursorMcpJson(targetMcp, sourceMcp);
      writeJson(targetMcp, merged);
      logSuccess(context.logger, ".mcp.json (merged)");
    } else {
      cpSync(sourceMcp, targetMcp);
      logSuccess(context.logger, ".mcp.json (copied)");
    }
  }
}

function copyPlatformContents(
  sourceDir: string,
  targetDir: string,
  logger?: Logger,
  skipNames: ReadonlySet<string> = new Set(),
): void {
  ensureDir(targetDir);
  for (const entry of readdirSync(sourceDir)) {
    if (skipNames.has(entry)) {
      continue;
    }

    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, entry);
    rmSync(targetPath, { recursive: true, force: true });
    cpSync(sourcePath, targetPath, { recursive: true });
    logSuccess(logger, entry);
  }
}

function mergeSettingsJson(existingPath: string, generatedPath: string): Record<string, unknown> {
  const existing = readJson(existingPath);
  const generated = readJson(generatedPath);
  return deepMerge(existing, generated);
}

function mergeCursorMcpJson(existingPath: string, generatedPath: string): Record<string, unknown> {
  const existing = readJson(existingPath);
  const generated = readJson(generatedPath);
  const existingServers = isPlainObject(existing.mcpServers) ? existing.mcpServers : {};
  const generatedServers = isPlainObject(generated.mcpServers) ? generated.mcpServers : {};

  return {
    ...existing,
    mcpServers: {
      ...existingServers,
      ...generatedServers,
    },
  };
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function writeJson(filePath: string, value: Record<string, unknown>): void {
  ensureDir(dirnameOf(filePath));
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function backupDirectory(targetDir: string, context: InstallContext): void {
  if (!context.backup || !existsSync(targetDir)) {
    return;
  }

  const backupPath = `${targetDir}.${context.timestamp}.backup`;
  cpSync(targetDir, backupPath, { recursive: true });
  logInfo(context.logger, `[backup] ${targetDir} -> ${backupPath}`);
}

function backupFile(targetPath: string, context: InstallContext): void {
  if (!context.backup || !existsSync(targetPath)) {
    return;
  }

  const backupPath = `${targetPath}.${context.timestamp}.backup`;
  cpSync(targetPath, backupPath);
  logInfo(context.logger, `[backup] ${targetPath} -> ${backupPath}`);
}

function installClaudePlugins(plugins: PluginsConfig, logger?: Logger): void {
  const claudePlugins = plugins.claude?.plugins ?? [];
  if (claudePlugins.length === 0) return;

  if (!commandExists("claude")) {
    logWarn(logger, "claude CLI not found - install marketplace plugins manually.");
    return;
  }

  for (const plugin of claudePlugins) {
    const source = plugin.source === "github" && plugin.repo ? plugin.repo : plugin.name;
    const result = spawnSync("claude", ["plugin", "add", "--from", source], {
      stdio: ["ignore", "ignore", "pipe"],
      shell: process.platform === "win32",
      encoding: "utf8",
    });
    if (result.status === 0) {
      logSuccess(logger, `Plugin: ${plugin.name}`);
    } else {
      const detail = (result.stderr ?? "").trim().split("\n").pop() || result.error?.message || `exit ${result.status}`;
      logWarn(logger, `Failed to install plugin: ${plugin.name} (${detail})`);
    }
  }
}

// map platform key to skills argument agent name
const PLATFORM_AGENT_NAMES: Partial<Record<Platform, string>> = {
  claude: "claude-code",
  opencode: "opencode",
  codex: "codex",
  cursor: "cursor",
  forgecode: "forgecode",
};

function installSkills(
  skills: readonly { name: string; args?: readonly string[] }[],
  platform: Platform | "*",
  logger?: Logger,
): void {
  if (skills.length === 0) return;
  const agentFlags =
    platform === "*"
      ? Object.values(PLATFORM_AGENT_NAMES)
          .map((name) => ["-a", name])
          .flat()
      : ["-a", PLATFORM_AGENT_NAMES[platform] ?? platform];

  for (const skill of skills) {
    const npxArgs = ["skills@latest", "add", skill.name, ...agentFlags, "--yes", ...(skill.args ?? [])];
    const result = spawnSync("npx", npxArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: homedir(),
      shell: process.platform === "win32",
      encoding: "utf8",
    });
    if (result.status !== 0) {
      const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
        .replace(/\u001b\[[0-9;]*m/gu, "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const detail = combined[combined.length - 1] || result.error?.message || `exit ${result.status}`;
      logWarn(logger, `Failed to install ${platform} skill: ${skill.name} (${detail})`);
      continue;
    }
    logSuccess(logger, `${platform} skill: ${skill.name}`);
  }
}

function commandExists(command: string): boolean {
  const lookupCommand = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookupCommand, [command], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return result.status === 0;
}

function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

function dirnameOf(filePath: string): string {
  return filePath.slice(0, filePath.length - basename(filePath).length).replace(/[\\/]$/u, "");
}

function makeTimestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(
    now.getMinutes(),
  )}${pad(now.getSeconds())}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function logHeader(logger: Logger | undefined, message: string): void {
  logger?.header(message);
}

function logInfo(logger: Logger | undefined, message: string): void {
  logger?.info(message);
}

function logSuccess(logger: Logger | undefined, message: string): void {
  logger?.success(message);
}

function logWarn(logger: Logger | undefined, message: string): void {
  logger?.warn(message);
}
