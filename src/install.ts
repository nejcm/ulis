import { spawn, spawnSync } from "node:child_process";
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
import { UlisConfigSchema, type ExtensionsConfig, type InstallLinkMode, type SkillsConfig } from "./schema.js";
import { loadValidatedConfigFile } from "./utils/config-loader.js";
import {
  capturePreservedNativeConfigs,
  PreservedNativeConfigParseError,
  writePreservedNativeConfigs,
  type CapturedPreservedNativeConfig,
} from "./utils/config-merger.js";
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
  /** Override local skill install mode from config.yaml. */
  readonly linkMode?: InstallLinkMode;
  /** When false, skip running extensions installers (`extensions.yaml`). */
  readonly installExtensions?: boolean;
}

type RunCommand = (
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawnSync>[2],
) => ReturnType<typeof spawnSync>;

interface AsyncCommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

type SkillInstallLog =
  | { readonly level: "success"; readonly message: string }
  | { readonly level: "warn"; readonly message: string };

type RunAsyncCommand = (
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawn>[2],
) => Promise<AsyncCommandResult>;

interface RuntimeDependencies {
  readonly runCommand: RunCommand;
  readonly runAsyncCommand: RunAsyncCommand;
}

const defaultRuntimeDependencies: RuntimeDependencies = {
  runCommand(command, args, options) {
    return spawnSync(command, [...args], options);
  },
  runAsyncCommand(command, args, options) {
    return runAsyncCommand(command, args, options);
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
export async function runInstall(options: InstallOptions): Promise<readonly Platform[]> {
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
  const linkMode = options.linkMode ?? ulisConfig.install?.linkMode ?? "copy";
  logInfo(logger, `Local skill link mode: ${linkMode}`);

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
        await installOpencode(context);
        break;
      case "claude":
        await installClaude(context);
        break;
      case "codex":
        await installCodex(context);
        break;
      case "cursor":
        await installCursor(context);
        break;
      case "forgecode":
        await installForgecode(context);
        break;
    }
  }

  const allSkills = skillsConfig["*"]?.skills ?? [];
  if (allSkills.length > 0) {
    logHeader(logger, "Installing External Skills");
    await installSkills(allSkills, "*", destBase, globalInstall, logger, platforms);
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

async function installOpencode(context: InstallContext): Promise<void> {
  const targetDir = platformConfigDir("opencode", context.destBase, context.userHome);
  const sourceDir = join(context.outputDir, "opencode");

  logHeader(context.logger, `Installing ${PLATFORM_LABELS.opencode}`);
  backupDirectory(targetDir, context);
  const preservedConfigs = capturePlatformPreservedNativeConfigs("opencode", context);

  removePath(targetDir);
  copyPath(sourceDir, targetDir);
  writePlatformPreservedNativeConfigs("opencode", preservedConfigs, context);
  logSuccess(context.logger, `OpenCode -> ${targetDir}`);

  const skills = context.skills.opencode?.skills ?? [];
  if (skills.length > 0) {
    await installSkills(skills, "opencode", context.destBase, context.globalInstall, context.logger);
  }

  runPlatformExtensions(context, "opencode");
}

async function installClaude(context: InstallContext): Promise<void> {
  const targetDir = platformConfigDir("claude", context.destBase, context.userHome);
  const sourceDir = join(context.outputDir, "claude");
  const targetRootConfig = join(context.destBase, ".claude.json");

  logHeader(context.logger, `Installing ${PLATFORM_LABELS.claude}`);
  backupDirectory(targetDir, context);
  backupFile(targetRootConfig, context);
  const preservedConfigs = capturePlatformPreservedNativeConfigs("claude", context);
  ensureDir(targetDir);

  writePlatformPreservedNativeConfigs("claude", preservedConfigs, context);

  copyPlatformContents(sourceDir, targetDir, context.logger, new Set(["settings.json", ".claude.json"]));

  const claudeSkills = context.skills.claude?.skills ?? [];
  if (claudeSkills.length > 0) {
    await installSkills(claudeSkills, "claude", context.destBase, context.globalInstall, context.logger);
  }

  runPlatformExtensions(context, "claude");
}

async function installCodex(context: InstallContext): Promise<void> {
  const targetDir = platformConfigDir("codex", context.destBase, context.userHome);
  const sourceDir = join(context.outputDir, "codex");

  logHeader(context.logger, `Installing ${PLATFORM_LABELS.codex}`);
  backupDirectory(targetDir, context);
  const preservedConfigs = capturePlatformPreservedNativeConfigs("codex", context);
  ensureDir(targetDir);
  copyPlatformContents(sourceDir, targetDir, context.logger, new Set(["config.toml"]));
  writePlatformPreservedNativeConfigs("codex", preservedConfigs, context);

  const skills = context.skills.codex?.skills ?? [];
  if (skills.length > 0) {
    await installSkills(skills, "codex", context.destBase, context.globalInstall, context.logger);
  }

  runPlatformExtensions(context, "codex");
}

async function installCursor(context: InstallContext): Promise<void> {
  const targetDir = platformConfigDir("cursor", context.destBase, context.userHome);
  const sourceDir = join(context.outputDir, "cursor");

  logHeader(context.logger, `Installing ${PLATFORM_LABELS.cursor}`);
  backupDirectory(targetDir, context);
  const preservedConfigs = capturePlatformPreservedNativeConfigs("cursor", context);
  ensureDir(targetDir);

  writePlatformPreservedNativeConfigs("cursor", preservedConfigs, context);

  copyPlatformContents(sourceDir, targetDir, context.logger, new Set(["mcp.json"]));

  const skills = context.skills.cursor?.skills ?? [];
  if (skills.length > 0) {
    await installSkills(skills, "cursor", context.destBase, context.globalInstall, context.logger);
  }

  runPlatformExtensions(context, "cursor");
}

async function installForgecode(context: InstallContext): Promise<void> {
  const sourceDir = join(context.outputDir, "forgecode");
  const sourceForgeDir = join(sourceDir, resolvePlatformDirSegment(PLATFORM_DIRS.forgecode.project));
  const targetForgeDir = platformConfigDir("forgecode", context.destBase, context.userHome);
  const targetMcp = join(targetForgeDir, ".mcp.json");

  logHeader(context.logger, `Installing ${PLATFORM_LABELS.forgecode}`);
  backupDirectory(targetForgeDir, context);
  backupFile(targetMcp, context);
  const preservedConfigs = capturePlatformPreservedNativeConfigs("forgecode", context);
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

  writePlatformPreservedNativeConfigs("forgecode", preservedConfigs, context);

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

function capturePlatformPreservedNativeConfigs(
  platform: Platform,
  context: InstallContext,
): readonly CapturedPreservedNativeConfig[] {
  try {
    return capturePreservedNativeConfigs(platform, context);
  } catch (error) {
    if (error instanceof PreservedNativeConfigParseError) {
      throw new InstallError(error.message, error);
    }
    throw new InstallError(`Failed to capture preserved native config for ${platform}`, error);
  }
}

function writePlatformPreservedNativeConfigs(
  platform: Platform,
  entries: readonly CapturedPreservedNativeConfig[],
  context: InstallContext,
): void {
  try {
    writePreservedNativeConfigs(entries, context.logger);
  } catch (error) {
    throw new InstallError(`Failed to write preserved native config for ${platform}`, error);
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

const SKILL_INSTALL_CONCURRENCY = 4;

async function installSkills(
  skills: readonly { key?: string; name: string; args?: readonly string[] }[],
  platform: Platform | "*",
  installBaseDir: string,
  globalInstall: boolean,
  logger?: Logger,
  selectedPlatforms: readonly Platform[] = [],
): Promise<void> {
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

  const results = await runBounded(skills, SKILL_INSTALL_CONCURRENCY, async (skill): Promise<SkillInstallLog> => {
    const npxArgs = [
      "skills@latest",
      "add",
      skill.name,
      ...agentFlags,
      ...(globalInstall ? ["-g"] : ["--project"]),
      "--yes",
      ...(skill.args ?? []),
    ];
    logInfo(logger, `Installing ${platform} skill: ${skill.key ?? skill.name}`);
    const result = await runSkillCommand("npx", npxArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: installBaseDir,
      shell: process.platform === "win32",
    });
    if (result.status !== 0) {
      const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
        .replace(/\u001b\[[0-9;]*m/gu, "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const detail = combined[combined.length - 1] || result.error?.message || `exit ${result.status}`;
      return {
        level: "warn",
        message: `Failed to install ${platform} skill: ${skill.key ?? skill.name} (${detail})`,
      };
    }
    return { level: "success", message: `${platform} skill: ${skill.key ?? skill.name}` };
  });

  for (const result of results) {
    if (result.level === "warn") logWarn(logger, result.message);
    else logSuccess(logger, result.message);
  }
}

async function runBounded<T, U>(
  items: readonly T[],
  concurrency: number,
  runItem: (item: T) => Promise<U>,
): Promise<readonly U[]> {
  let nextIndex = 0;
  const results: U[] = [];
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const itemIndex = nextIndex;
      const item = items[itemIndex]!;
      nextIndex += 1;
      results[itemIndex] = await runItem(item);
    }
  });
  await Promise.all(workers);
  return results;
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

async function runSkillCommand(
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawn>[2],
): Promise<AsyncCommandResult> {
  try {
    return await runtimeDependencies.runAsyncCommand(command, args, options);
  } catch (error) {
    throw new InstallError(`Failed to run command: ${command} ${args.join(" ")}`, error);
  }
}

function runAsyncCommand(
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawn>[2],
): Promise<AsyncCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], options);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer | string) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk: Buffer | string) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      resolve({
        status: 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        error,
      });
    });
    child.on("close", (status) => {
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
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
