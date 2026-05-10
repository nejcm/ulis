import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { runBuild, type Logger } from "./build.js";
import { ULIS_GENERATED_DIRNAME } from "./config.js";
import { loadExtensions, mergeExtensionsConfigs } from "./parsers/extensions.js";
import { loadSkills, mergeSkillsConfigs } from "./parsers/skills.js";
import {
  isSamePath,
  PLATFORM_DIRS,
  PLATFORM_LABELS,
  platformConfigDir,
  PLATFORMS,
  resolvePlatformDirSegment,
  uniquePlatforms,
  type Platform,
} from "./platforms.js";
import { UlisConfigSchema, type ExtensionsConfig, type SkillsConfig } from "./schema.js";
import { loadValidatedConfigFile } from "./utils/config-loader.js";
import { mergeConfigValues, readMergeableConfig, writeMergeableConfig } from "./utils/config-merger.js";
import { logger as defaultLogger } from "./utils/logger.js";
import type { ResolvedPreset } from "./utils/resolve-presets.js";

export type Runner = "npx" | "bunx";

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
  /** Install skills globally (`npx skills ... -g`) instead of project-local. */
  readonly globalInstall?: boolean;
  readonly backup?: boolean;
  readonly rebuild?: boolean;
  readonly logger?: Logger;
  readonly userHome?: string;
  /** Resolved presets to merge at build time and for external skill installs. */
  readonly presets?: readonly ResolvedPreset[];
  /** Override the package runner used for `extensions.yaml` entries. */
  readonly runner?: Runner;
  /** When false, skip running extensions installers (`extensions.yaml`). */
  readonly installExtensions?: boolean;
}

type RunCommand = (
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawnSync>[2],
) => ReturnType<typeof spawnSync>;

interface RuntimeDependencies {
  readonly runCommand: RunCommand;
}

const defaultRuntimeDependencies: RuntimeDependencies = {
  runCommand(command, args, options) {
    return spawnSync(command, [...args], options);
  },
};

let runtimeDependencies: RuntimeDependencies = { ...defaultRuntimeDependencies };

class InstallError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "InstallError";
  }
}

/**
 * Load environment variables from `<rootDir>/.env` without overriding existing values.
 */
export function loadDotEnv(rootDir: string, env: NodeJS.ProcessEnv = process.env): void {
  const envPath = join(rootDir, ".env");
  if (!existsSync(envPath)) {
    return;
  }

  let lines: readonly string[];
  try {
    lines = readFileSync(envPath, "utf8").split(/\r?\n/u);
  } catch (error) {
    throw new InstallError(`Failed to read .env file at ${envPath}`, error);
  }

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

    const hasMatchingQuotes =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"));
    env[key] = hasMatchingQuotes ? rawValue.slice(1, -1) : rawValue;
  }
}

/**
 * Install generated per-platform configs from source to destination base directory.
 */
export function runInstall(options: InstallOptions): readonly Platform[] {
  const logger = options.logger ?? defaultLogger;
  const sourceDir = resolve(options.sourceDir);
  const destBase = resolve(options.destBase);
  const outputDir = resolve(options.outputDir ?? join(sourceDir, ULIS_GENERATED_DIRNAME));
  const platforms = options.platforms ? uniquePlatforms(options.platforms) : [...PLATFORMS];
  const userHome = resolve(options.userHome ?? homedir());
  const globalInstall = options.globalInstall ?? isSamePath(destBase, userHome);
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
    runBuild({ targets: platforms, sourceDir, outputDir, logger, presets: options.presets });
  }

  const skillsConfig = mergeSkillsConfigs([
    ...(options.presets ?? []).map((preset) => loadSkills(preset.dir)),
    loadSkills(sourceDir),
  ]);
  const extensionsConfig = mergeExtensionsConfigs([
    ...(options.presets ?? []).map((preset) => loadExtensions(preset.dir)),
    loadExtensions(sourceDir),
  ]);

  const installExtensionsEnabled = options.installExtensions ?? true;
  const ulisConfig = loadValidatedConfigFile({
    dir: sourceDir,
    baseName: "config",
    schema: UlisConfigSchema,
    defaultValue: { version: 1, name: "ulis" },
  });
  const runner = resolveRunner({ cliFlag: options.runner, configValue: ulisConfig.runner });

  const timestamp = makeTimestamp();
  for (const platform of platforms) {
    const context: InstallContext = {
      outputDir,
      destBase,
      userHome,
      globalInstall,
      backup,
      timestamp,
      skills: skillsConfig,
      extensions: extensionsConfig,
      runner,
      installExtensionsEnabled,
      logger,
    };
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

  const allSkills = skillsConfig["*"]?.skills ?? [];
  if (allSkills.length > 0) {
    logHeader(logger, "Installing External Skills");
    installSkills(allSkills, "*", destBase, globalInstall, logger, platforms);
  }

  if (installExtensionsEnabled) {
    const allExtensions = extensionsConfig["*"]?.extensions ?? [];
    if (allExtensions.length > 0) {
      logHeader(logger, "Installing Extensions");
      installExtensions(allExtensions, "*", destBase, runner, logger);
    }
  }

  logHeader(logger, "Installation Complete");
  return platforms;
}

interface InstallContext {
  readonly outputDir: string;
  readonly destBase: string;
  readonly userHome: string;
  readonly globalInstall: boolean;
  readonly backup: boolean;
  readonly timestamp: string;
  readonly skills: SkillsConfig;
  readonly extensions: ExtensionsConfig;
  readonly runner: Runner;
  readonly installExtensionsEnabled: boolean;
  readonly logger?: Logger;
}

function installOpencode(context: InstallContext): void {
  const targetDir = platformConfigDir("opencode", context.destBase, context.userHome);
  const sourceDir = join(context.outputDir, "opencode");
  const sourceConfig = join(sourceDir, "opencode.json");
  const targetConfig = join(targetDir, "opencode.json");

  logHeader(context.logger, `Installing ${PLATFORM_LABELS.opencode}`);
  backupDirectory(targetDir, context);
  const preservedConfig = preserveConfigPaths(targetConfig, [["mcp"]]);

  removePath(targetDir);
  copyPath(sourceDir, targetDir);
  writeMergedNativeConfig(sourceConfig, targetConfig, preservedConfig, "opencode.json", context.logger);
  logSuccess(context.logger, `OpenCode -> ${targetDir}`);

  const skills = context.skills.opencode?.skills ?? [];
  if (skills.length > 0) {
    installSkills(skills, "opencode", context.destBase, context.globalInstall, context.logger);
  }

  runPlatformExtensions(context, "opencode");
}

function installClaude(context: InstallContext): void {
  const targetDir = platformConfigDir("claude", context.destBase, context.userHome);
  const sourceDir = join(context.outputDir, "claude");
  const generatedSettings = join(sourceDir, "settings.json");
  const targetSettings = join(targetDir, "settings.json");
  const generatedRootConfig = join(sourceDir, ".claude.json");
  const targetRootConfig = join(context.destBase, ".claude.json");

  logHeader(context.logger, `Installing ${PLATFORM_LABELS.claude}`);
  backupDirectory(targetDir, context);
  backupFile(targetRootConfig, context);
  const preservedSettings = preserveConfigPaths(targetSettings, [["hooks"]]);
  const preservedRootConfig = preserveConfigPaths(targetRootConfig, [["mcpServers"]]);
  ensureDir(targetDir);

  writeMergedNativeConfig(generatedSettings, targetSettings, preservedSettings, "settings.json", context.logger);
  writeMergedNativeConfig(generatedRootConfig, targetRootConfig, preservedRootConfig, ".claude.json", context.logger);

  copyPlatformContents(sourceDir, targetDir, context.logger, new Set(["settings.json", ".claude.json"]));

  const claudeSkills = context.skills.claude?.skills ?? [];
  if (claudeSkills.length > 0) {
    installSkills(claudeSkills, "claude", context.destBase, context.globalInstall, context.logger);
  }

  runPlatformExtensions(context, "claude");
}

function installCodex(context: InstallContext): void {
  const targetDir = platformConfigDir("codex", context.destBase, context.userHome);
  const sourceDir = join(context.outputDir, "codex");
  const sourceConfig = join(sourceDir, "config.toml");
  const targetConfig = join(targetDir, "config.toml");

  logHeader(context.logger, `Installing ${PLATFORM_LABELS.codex}`);
  backupDirectory(targetDir, context);
  const preservedConfig = preserveConfigPaths(targetConfig, [["projects"], ["hooks"], ["mcp_servers"]]);
  ensureDir(targetDir);
  copyPlatformContents(sourceDir, targetDir, context.logger, new Set(["config.toml"]));
  writeMergedNativeConfig(sourceConfig, targetConfig, preservedConfig, "config.toml", context.logger);

  const skills = context.skills.codex?.skills ?? [];
  if (skills.length > 0) {
    installSkills(skills, "codex", context.destBase, context.globalInstall, context.logger);
  }

  runPlatformExtensions(context, "codex");
}

function installCursor(context: InstallContext): void {
  const targetDir = platformConfigDir("cursor", context.destBase, context.userHome);
  const sourceDir = join(context.outputDir, "cursor");
  const generatedMcp = join(sourceDir, "mcp.json");
  const targetMcp = join(targetDir, "mcp.json");

  logHeader(context.logger, `Installing ${PLATFORM_LABELS.cursor}`);
  backupDirectory(targetDir, context);
  const preservedMcp = preserveConfigPaths(targetMcp, [["mcpServers"]]);
  ensureDir(targetDir);

  writeMergedNativeConfig(generatedMcp, targetMcp, preservedMcp, "mcp.json", context.logger);

  copyPlatformContents(sourceDir, targetDir, context.logger, new Set(["mcp.json"]));

  const skills = context.skills.cursor?.skills ?? [];
  if (skills.length > 0) {
    installSkills(skills, "cursor", context.destBase, context.globalInstall, context.logger);
  }

  runPlatformExtensions(context, "cursor");
}

function installForgecode(context: InstallContext): void {
  const sourceDir = join(context.outputDir, "forgecode");
  const sourceForgeDir = join(sourceDir, resolvePlatformDirSegment(PLATFORM_DIRS.forgecode.project));
  const sourceMcp = join(sourceForgeDir, ".mcp.json");
  const targetForgeDir = platformConfigDir("forgecode", context.destBase, context.userHome);
  const targetMcp = join(targetForgeDir, ".mcp.json");

  logHeader(context.logger, `Installing ${PLATFORM_LABELS.forgecode}`);
  backupDirectory(targetForgeDir, context);
  backupFile(targetMcp, context);
  const preservedMcp = preserveConfigPaths(targetMcp, [["mcpServers"]]);
  ensureDir(targetForgeDir);

  if (existsSync(sourceForgeDir)) {
    copyPlatformContents(sourceForgeDir, targetForgeDir, context.logger, new Set([".mcp.json"]));
  }

  copyPlatformContents(
    sourceDir,
    targetForgeDir,
    context.logger,
    new Set([resolvePlatformDirSegment(PLATFORM_DIRS.forgecode.project)]),
  );

  writeMergedNativeConfig(sourceMcp, targetMcp, preservedMcp, ".mcp.json", context.logger);

  runPlatformExtensions(context, "forgecode");
}

function copyPlatformContents(
  sourceDir: string,
  targetDir: string,
  logger?: Logger,
  skipNames: ReadonlySet<string> = new Set(),
): void {
  ensureDir(targetDir);
  if (!existsSync(sourceDir)) {
    throw new InstallError(`Generated platform directory does not exist: ${sourceDir}`);
  }

  const entries = readDirectoryEntries(sourceDir);
  for (const entry of entries) {
    if (skipNames.has(entry)) {
      continue;
    }

    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, entry);
    removePath(targetPath);
    copyPath(sourcePath, targetPath);
    logSuccess(logger, entry);
  }
}

function preserveConfigPaths(filePath: string, paths: readonly (readonly string[])[]): unknown | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const preserved = pickConfigPaths(readMergeableConfig(filePath), paths);
    return Object.keys(preserved).length > 0 ? preserved : undefined;
  } catch (error) {
    throw new InstallError(`Failed to parse existing native config at ${filePath}`, error);
  }
}

function pickConfigPaths(source: unknown, paths: readonly (readonly string[])[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const path of paths) {
    const value = getConfigPath(source, path);
    if (value !== undefined) setConfigPath(result, path, value);
  }
  return result;
}

function getConfigPath(source: unknown, path: readonly string[]): unknown {
  let current = source;
  for (const key of path) {
    if (!isPlainObject(current) || !(key in current)) return undefined;
    current = current[key];
  }
  return current;
}

function setConfigPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let current = target;
  for (const key of path.slice(0, -1)) {
    const next = current[key];
    if (isPlainObject(next)) {
      current = next;
    } else {
      const created: Record<string, unknown> = {};
      current[key] = created;
      current = created;
    }
  }
  current[path[path.length - 1]!] = value;
}

function writeMergedNativeConfig(
  generatedPath: string,
  targetPath: string,
  preservedExisting: unknown | undefined,
  label: string,
  logger?: Logger,
): void {
  try {
    if (!existsSync(generatedPath)) {
      if (preservedExisting !== undefined) {
        writeMergeableConfig(targetPath, preservedExisting);
        logSuccess(logger, `${label} (preserved)`);
      } else if (existsSync(targetPath)) {
        removePath(targetPath);
        logSuccess(logger, `${label} (removed)`);
      }
      return;
    }

    if (preservedExisting === undefined) {
      cpSync(generatedPath, targetPath);
      logSuccess(logger, `${label} (copied)`);
      return;
    }

    const generated = readMergeableConfig(generatedPath);
    writeMergeableConfig(targetPath, mergeConfigValues(preservedExisting, generated));
    logSuccess(logger, `${label} (merged)`);
  } catch (error) {
    throw new InstallError(`Failed to merge native config ${generatedPath} -> ${targetPath}`, error);
  }
}

function backupDirectory(targetDir: string, context: InstallContext): void {
  if (!context.backup || !existsSync(targetDir)) {
    return;
  }

  const backupPath = `${targetDir}.${context.timestamp}.backup`;
  copyPath(targetDir, backupPath);
  logInfo(context.logger, `[backup] ${targetDir} -> ${backupPath}`);
}

function backupFile(targetPath: string, context: InstallContext): void {
  if (!context.backup || !existsSync(targetPath)) {
    return;
  }

  const backupPath = `${targetPath}.${context.timestamp}.backup`;
  copyPath(targetPath, backupPath);
  logInfo(context.logger, `[backup] ${targetPath} -> ${backupPath}`);
}

// map platform key to skills argument agent name
// only platforms supported by the `skills` CLI are listed here
const SKILL_PLATFORM_AGENT_NAMES: Partial<Record<Platform, string>> = {
  claude: "claude-code",
  opencode: "opencode",
  codex: "codex",
  cursor: "cursor",
};

function installSkills(
  skills: readonly { key?: string; name: string; args?: readonly string[] }[],
  platform: Platform | "*",
  installBaseDir: string,
  globalInstall: boolean,
  logger?: Logger,
  selectedPlatforms: readonly Platform[] = [],
): void {
  if (skills.length === 0) return;
  const agentNames =
    platform === "*"
      ? selectedPlatforms.flatMap((selectedPlatform) => {
          const agentName = SKILL_PLATFORM_AGENT_NAMES[selectedPlatform];
          return agentName ? [agentName] : [];
        })
      : [SKILL_PLATFORM_AGENT_NAMES[platform] ?? platform];
  if (agentNames.length === 0) return;
  const agentFlags = ["-a", ...agentNames];

  for (const skill of skills) {
    const npxArgs = [
      "skills@latest",
      "add",
      skill.name,
      ...agentFlags,
      ...(globalInstall ? ["-g"] : ["--project"]),
      "--yes",
      ...(skill.args ?? []),
    ];
    const result = runCommand("npx", npxArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: installBaseDir,
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
      logWarn(logger, `Failed to install ${platform} skill: ${skill.key ?? skill.name} (${detail})`);
      continue;
    }
    logSuccess(logger, `${platform} skill: ${skill.key ?? skill.name}`);
  }
}

function runPlatformExtensions(context: InstallContext, platform: Platform): void {
  if (!context.installExtensionsEnabled) return;
  const entries = context.extensions[platform]?.extensions ?? [];
  if (entries.length === 0) return;
  installExtensions(entries, platform, context.destBase, context.runner, context.logger);
}

function installExtensions(
  extensions: readonly { key?: string; name: string; args?: readonly string[] }[],
  platform: Platform | "*",
  installBaseDir: string,
  runner: Runner,
  logger?: Logger,
): void {
  if (extensions.length === 0) return;
  if (!commandExists(runner)) {
    logWarn(logger, `${runner} not found on PATH - skipping ${platform} extensions.`);
    return;
  }

  for (const extension of extensions) {
    const args = [extension.name, ...(extension.args ?? [])];
    logInfo(logger, `Will run: ${runner} ${args.join(" ")}`);

    const result = runCommand(runner, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: installBaseDir,
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
      logWarn(logger, `Failed to install ${platform} extension: ${extension.key ?? extension.name} (${detail})`);
      continue;
    }
    logSuccess(logger, `${platform} extension: ${extension.key ?? extension.name}`);
  }
}

/**
 * Resolve which package runner to use for `extensions.yaml` entries.
 * Precedence: CLI flag → config.yaml → auto-detect (`bunx` if present, else `npx`).
 */
export function resolveRunner({
  cliFlag,
  configValue,
  hasCommand = commandExists,
}: {
  cliFlag?: Runner;
  configValue?: Runner;
  hasCommand?: (cmd: string) => boolean;
}): Runner {
  if (cliFlag) return cliFlag;
  if (configValue) return configValue;
  return hasCommand("bunx") ? "bunx" : "npx";
}

function commandExists(command: string): boolean {
  const lookupCommand = process.platform === "win32" ? "where" : "which";
  const result = runCommand(lookupCommand, [command], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return result.status === 0;
}

function ensureDir(dirPath: string): void {
  try {
    mkdirSync(dirPath, { recursive: true });
  } catch (error) {
    throw new InstallError(`Failed to create directory: ${dirPath}`, error);
  }
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

function readDirectoryEntries(dirPath: string): readonly string[] {
  try {
    return readdirSync(dirPath);
  } catch (error) {
    throw new InstallError(`Failed to list directory: ${dirPath}`, error);
  }
}

function removePath(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (error) {
    throw new InstallError(`Failed to remove path: ${path}`, error);
  }
}

function copyPath(sourcePath: string, targetPath: string): void {
  try {
    cpSync(sourcePath, targetPath, { recursive: true });
  } catch (error) {
    throw new InstallError(`Failed to copy ${sourcePath} -> ${targetPath}`, error);
  }
}

function runCommand(command: string, args: readonly string[], options: Parameters<typeof spawnSync>[2]) {
  try {
    return runtimeDependencies.runCommand(command, args, options);
  } catch (error) {
    throw new InstallError(`Failed to run command: ${command} ${args.join(" ")}`, error);
  }
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

export const __test = {
  setRuntimeDependencies(overrides: Partial<RuntimeDependencies>): void {
    runtimeDependencies = { ...runtimeDependencies, ...overrides };
  },
  resetRuntimeDependencies(): void {
    runtimeDependencies = { ...defaultRuntimeDependencies };
  },
};
