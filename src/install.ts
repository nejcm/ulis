import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { analyzePresets, runBuild, type Logger } from "./build.js";
import { ULIS_GENERATED_DIRNAME } from "./config.js";
import { generate, writeResult } from "./generators/index.js";
import { InstallError } from "./install/errors.js";
import { installClaude, installCodex, installCursor, installForgecode, installOpencode } from "./install/platforms.js";
import type { InstallContext, Runner as InstallRunner } from "./install/types.js";
import { loadExtensions, mergeExtensionsConfigs } from "./parsers/extensions.js";
import { loadSkills, mergeSkillsConfigs } from "./parsers/skills.js";
import { isSamePath, PLATFORMS, uniquePlatforms, type Platform } from "./platforms.js";
import { UlisConfigSchema, type ExtensionsConfig, type SkillsConfig } from "./schema.js";
import { loadValidatedConfigFile } from "./utils/config-loader.js";
import { logger as defaultLogger } from "./utils/logger.js";
import type { ResolvedPreset } from "./utils/resolve-presets.js";

export type { Runner } from "./install/types.js";

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
  readonly runner?: InstallRunner;
  /** When false, skip running extensions installers (`extensions.yaml`). */
  readonly installExtensions?: boolean;
}

export interface PresetInstallOptions {
  readonly platforms?: readonly Platform[];
  /** Presets to install as the complete source. Applied in order; later presets win conflicts. */
  readonly presets: readonly ResolvedPreset[];
  /** Where the per-platform configs land — typically `~` for global, CWD for project. */
  readonly destBase: string;
  /** Install skills globally (`npx skills ... -g`) instead of project-local. */
  readonly globalInstall?: boolean;
  readonly backup?: boolean;
  readonly logger?: Logger;
  readonly userHome?: string;
  /** Override the package runner used for `extensions.yaml` entries. */
  readonly runner?: InstallRunner;
  /** When false, skip running extensions installers (`extensions.yaml`). */
  readonly installExtensions?: boolean;
  readonly signal?: AbortSignal;
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
  { readonly level: "success"; readonly message: string } | { readonly level: "warn"; readonly message: string };

type RunAsyncCommand = (
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawn>[2],
) => Promise<AsyncCommandResult>;

interface RuntimeDependencies {
  readonly runCommand: RunCommand;
  readonly runAsyncCommand: RunAsyncCommand;
}

interface GeneratedInstallOptions {
  readonly outputDir: string;
  readonly destBase: string;
  readonly userHome: string;
  readonly globalInstall: boolean;
  readonly backup: boolean;
  readonly platforms: readonly Platform[];
  readonly skillsConfig: SkillsConfig;
  readonly extensionsConfig: ExtensionsConfig;
  readonly runner: InstallRunner;
  readonly installExtensionsEnabled: boolean;
  readonly logger: Logger;
  readonly signal?: AbortSignal;
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

  await installGeneratedOutput({
    outputDir,
    destBase,
    userHome,
    globalInstall,
    backup,
    platforms,
    skillsConfig,
    extensionsConfig,
    runner,
    installExtensionsEnabled,
    logger,
  });

  logHeader(logger, "Installation Complete");
  return platforms;
}

/**
 * Install selected presets as the complete source without requiring a base source tree.
 */
export async function runPresetInstall(options: PresetInstallOptions): Promise<readonly Platform[]> {
  const logger = options.logger ?? defaultLogger;
  const presets = options.presets;
  if (presets.length === 0) {
    throw new Error("Select at least one preset to install.");
  }

  const destBase = resolve(options.destBase);
  const platforms = options.platforms ? uniquePlatforms(options.platforms) : [...PLATFORMS];
  const userHome = resolve(options.userHome ?? homedir());
  const globalInstall = options.globalInstall ?? isSamePath(destBase, userHome);
  const backup = options.backup ?? false;
  const installExtensionsEnabled = options.installExtensions ?? true;
  const runner = resolveRunner({ cliFlag: options.runner });
  const tempRoot = mkdtempSync(join(tmpdir(), "ulis-preset-install-"));
  const outputDir = join(tempRoot, ULIS_GENERATED_DIRNAME);

  try {
    loadDotEnv(destBase);

    logHeader(logger, `ULIS Preset Install (${process.platform === "win32" ? "Windows" : "Linux/macOS"})`);
    logInfo(logger, `Presets: ${presets.map((preset) => preset.name).join(", ")}`);
    logInfo(logger, `Output (temporary): ${outputDir}`);
    logInfo(logger, `Destination base: ${destBase}`);
    logInfo(logger, `Platforms: ${platforms.join(", ")}`);

    if (platforms.length === 0) {
      logWarn(logger, "No platforms selected. Nothing to install.");
      return [];
    }

    throwIfAborted(options.signal);
    const analysis = analyzePresets({ presets, logger });
    for (const target of platforms) {
      throwIfAborted(options.signal);
      const outDir = join(outputDir, target);
      const result = generate(target, analysis.project);
      if (!result) throw new Error(`No generator registered for platform: ${target}`);
      writeResult(result, outDir, target, logger);
    }

    throwIfAborted(options.signal);
    const skillsConfig = mergeSkillsConfigs(presets.map((preset) => loadSkills(preset.dir)));
    const extensionsConfig = mergeExtensionsConfigs(presets.map((preset) => loadExtensions(preset.dir)));

    await installGeneratedOutput({
      outputDir,
      destBase,
      userHome,
      globalInstall,
      backup,
      platforms,
      skillsConfig,
      extensionsConfig,
      runner,
      installExtensionsEnabled,
      logger,
      signal: options.signal,
    });

    throwIfAborted(options.signal);
    logHeader(logger, "Preset Installation Complete");
    return platforms;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function installGeneratedOutput(options: GeneratedInstallOptions): Promise<void> {
  const timestamp = makeTimestamp();
  const context: InstallContext = {
    outputDir: options.outputDir,
    destBase: options.destBase,
    userHome: options.userHome,
    globalInstall: options.globalInstall,
    backup: options.backup,
    timestamp,
    extensions: options.extensionsConfig,
    runner: options.runner,
    installExtensionsEnabled: options.installExtensionsEnabled,
    logger: options.logger,
  };

  for (const platform of options.platforms) {
    throwIfAborted(options.signal);
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

  for (const platform of options.platforms) {
    throwIfAborted(options.signal);
    const platformSkills = options.skillsConfig[platform]?.skills ?? [];
    if (platformSkills.length > 0) {
      await installSkills(
        platformSkills,
        platform,
        options.destBase,
        options.globalInstall,
        options.logger,
        [],
        options.signal,
      );
    }
  }

  const allSkills = options.skillsConfig["*"]?.skills ?? [];
  if (allSkills.length > 0) {
    logHeader(options.logger, "Installing External Skills");
    await installSkills(
      allSkills,
      "*",
      options.destBase,
      options.globalInstall,
      options.logger,
      options.platforms,
      options.signal,
    );
  }

  if (!options.installExtensionsEnabled) return;

  for (const platform of options.platforms) {
    throwIfAborted(options.signal);
    await runPlatformExtensions(context, platform, options.signal);
  }

  const allExtensions = options.extensionsConfig["*"]?.extensions ?? [];
  if (allExtensions.length > 0) {
    logHeader(options.logger, "Installing Extensions");
    await installExtensions(allExtensions, "*", options.destBase, options.runner, options.logger, options.signal);
  }
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

function normalizeSkillArgs(args: readonly string[] = []): string[] {
  return args.flatMap((arg) => arg.trim().split(/\s+/));
}

async function installSkills(
  skills: readonly { key?: string; name: string; args?: readonly string[] }[],
  platform: Platform | "*",
  installBaseDir: string,
  globalInstall: boolean,
  logger?: Logger,
  selectedPlatforms: readonly Platform[] = [],
  signal?: AbortSignal,
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

  const results = await runBounded(
    skills,
    SKILL_INSTALL_CONCURRENCY,
    async (skill): Promise<SkillInstallLog> => {
      throwIfAborted(signal);
      const npxArgs = [
        "skills@latest",
        "add",
        skill.name,
        ...agentFlags,
        ...(globalInstall ? ["-g"] : ["--project"]),
        "--yes",
        ...normalizeSkillArgs(skill.args),
      ];
      logInfo(logger, `Installing ${platform} skill: ${skill.key ?? skill.name}`);
      const result = await runSkillCommand("npx", npxArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: installBaseDir,
        shell: process.platform === "win32",
        signal,
      });
      throwIfAborted(signal);
      if (result.status !== 0) {
        return {
          level: "warn",
          message: `Failed to install ${platform} skill: ${skill.key ?? skill.name} (${formatCommandFailure(result)})`,
        };
      }
      return { level: "success", message: `${platform} skill: ${skill.key ?? skill.name}` };
    },
    signal,
  );

  for (const result of results) {
    if (result.level === "warn") logWarn(logger, result.message);
    else logSuccess(logger, result.message);
  }
}

async function runBounded<T, U>(
  items: readonly T[],
  concurrency: number,
  runItem: (item: T) => Promise<U>,
  signal?: AbortSignal,
): Promise<readonly U[]> {
  let nextIndex = 0;
  const results: U[] = [];
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      throwIfAborted(signal);
      const itemIndex = nextIndex;
      const item = items[itemIndex]!;
      nextIndex += 1;
      results[itemIndex] = await runItem(item);
    }
  });
  await Promise.all(workers);
  return results;
}

async function runPlatformExtensions(context: InstallContext, platform: Platform, signal?: AbortSignal): Promise<void> {
  if (!context.installExtensionsEnabled) return;
  const entries = context.extensions[platform]?.extensions ?? [];
  if (entries.length === 0) return;
  await installExtensions(entries, platform, context.destBase, context.runner, context.logger, signal);
}

async function installExtensions(
  extensions: readonly { key?: string; name: string; args?: readonly string[] }[],
  platform: Platform | "*",
  installBaseDir: string,
  runner: InstallRunner,
  logger?: Logger,
  signal?: AbortSignal,
): Promise<void> {
  if (extensions.length === 0) return;
  if (!commandExists(runner)) {
    logWarn(logger, `${runner} not found on PATH - skipping ${platform} extensions.`);
    return;
  }

  for (const extension of extensions) {
    throwIfAborted(signal);
    const args = [extension.name, ...(extension.args ?? [])];
    logInfo(logger, `Will run: ${runner} ${args.join(" ")}`);

    const result = await runSkillCommand(runner, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: installBaseDir,
      shell: process.platform === "win32",
      signal,
    });
    throwIfAborted(signal);
    if (result.status !== 0) {
      logWarn(
        logger,
        `Failed to install ${platform} extension: ${extension.key ?? extension.name} (${formatCommandFailure(result)})`,
      );
      continue;
    }
    logSuccess(logger, `${platform} extension: ${extension.key ?? extension.name}`);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Preset install stopped by user.");
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
  cliFlag?: InstallRunner;
  configValue?: InstallRunner;
  hasCommand?: (cmd: string) => boolean;
}): InstallRunner {
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

function formatCommandFailure(result: { stdout?: unknown; stderr?: unknown; status?: unknown; error?: Error }): string {
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const combined = `${stdout}\n${stderr}`
    // oxlint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/gu, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return combined[combined.length - 1] || result.error?.message || `exit ${result.status}`;
}

function makeTimestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(
    now.getMinutes(),
  )}${pad(now.getSeconds())}`;
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
