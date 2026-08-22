import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { ULIS_PROVENANCE_FILENAME } from "../config.js";
import {
  PLATFORM_DIRS,
  PLATFORM_LABELS,
  PLATFORMS,
  isSamePath,
  platformConfigDir,
  resolvePlatformDirSegment,
  type Platform,
} from "../platforms.js";
import {
  capturePreservedNativeConfigs,
  nativeConfigFilenames,
  PreservedNativeConfigParseError,
  UnsafeNativeConfigPathError,
  writePreservedNativeConfigs,
  type CapturedPreservedNativeConfig,
} from "../utils/config-merger.js";
import { InstallError } from "./errors.js";
import { backupPath, copyPlatformContents, copyToNewPath, ensureDir, readDirectoryEntries } from "./fs.js";
import { MANAGED_PLATFORM_LAYOUTS } from "./layouts.js";
import { ULIS_MANIFEST_FILENAME, type PlatformOwnership } from "./manifest.js";
import type { InstallContext } from "./types.js";

/** Enough to clear a same-second collision; a run needing more has a directory full of backups. */
const MAX_BACKUP_ATTEMPTS = 100;

const PLATFORM_INSTALL_SKIP_NAMES: Readonly<Record<Platform, ReadonlySet<string>>> = Object.fromEntries(
  PLATFORMS.map((platform) => [platform, reservedNames(...nativeConfigFilenames(platform))]),
) as Record<Platform, ReadonlySet<string>>;

export async function installOpencode(context: InstallContext, ownership?: PlatformOwnership): Promise<void> {
  const targetDir = platformConfigDir("opencode", context.destBase, context.userHome);
  const sourceDir = join(context.outputDir, "opencode");

  logHeader(context, `Installing ${PLATFORM_LABELS.opencode}`);
  warnLegacyOpencodeDirectories(context);
  backupDirectory(targetDir, context);
  const preservedConfigs = capturePlatformPreservedNativeConfigs("opencode", context);
  ensureDir(targetDir);
  writePlatformPreservedNativeConfigs("opencode", preservedConfigs, context);

  copyPlatformContents(sourceDir, targetDir, {
    logger: context.logger,
    skipNames: PLATFORM_INSTALL_SKIP_NAMES.opencode,
    namedDirectories: managedDirectoryRules("opencode"),
    pruneExtraNames: context.prune,
    previouslyManagedRootEntries: ownership?.previous?.rootEntries,
    currentManagedRootEntries: ownership?.current.rootEntries,
  });
  logSuccess(context, `OpenCode -> ${targetDir}`);
}

export async function installClaude(context: InstallContext): Promise<void> {
  const targetDir = platformConfigDir("claude", context.destBase, context.userHome);
  const sourceDir = join(context.outputDir, "claude");
  const targetRootConfig = isSamePath(context.destBase, context.userHome)
    ? join(context.destBase, ".claude.json")
    : join(context.destBase, ".mcp.json");

  logHeader(context, `Installing ${PLATFORM_LABELS.claude}`);
  backupDirectory(targetDir, context);
  backupFile(targetRootConfig, context);
  const preservedConfigs = capturePlatformPreservedNativeConfigs("claude", context);
  ensureDir(targetDir);

  writePlatformPreservedNativeConfigs("claude", preservedConfigs, context);

  copyPlatformContents(sourceDir, targetDir, {
    logger: context.logger,
    skipNames: PLATFORM_INSTALL_SKIP_NAMES.claude,
    namedDirectories: managedDirectoryRules("claude"),
  });
}

export async function installCodex(context: InstallContext): Promise<void> {
  const targetDir = platformConfigDir("codex", context.destBase, context.userHome);
  const sourceDir = join(context.outputDir, "codex");

  logHeader(context, `Installing ${PLATFORM_LABELS.codex}`);
  backupDirectory(targetDir, context);
  const preservedConfigs = capturePlatformPreservedNativeConfigs("codex", context);
  ensureDir(targetDir);
  writePlatformPreservedNativeConfigs("codex", preservedConfigs, context);
  copyPlatformContents(sourceDir, targetDir, {
    logger: context.logger,
    skipNames: PLATFORM_INSTALL_SKIP_NAMES.codex,
    namedDirectories: managedDirectoryRules("codex"),
  });
}

export async function installCursor(context: InstallContext): Promise<void> {
  const targetDir = platformConfigDir("cursor", context.destBase, context.userHome);
  const sourceDir = join(context.outputDir, "cursor");

  logHeader(context, `Installing ${PLATFORM_LABELS.cursor}`);
  backupDirectory(targetDir, context);
  const preservedConfigs = capturePlatformPreservedNativeConfigs("cursor", context);
  ensureDir(targetDir);

  writePlatformPreservedNativeConfigs("cursor", preservedConfigs, context);

  copyPlatformContents(sourceDir, targetDir, {
    logger: context.logger,
    skipNames: PLATFORM_INSTALL_SKIP_NAMES.cursor,
    namedDirectories: managedDirectoryRules("cursor"),
  });
}

export async function installForgecode(context: InstallContext): Promise<void> {
  const sourceDir = join(context.outputDir, "forgecode");
  const sourceForgeDir = join(sourceDir, resolvePlatformDirSegment(PLATFORM_DIRS.forgecode.project));
  const targetForgeDir = platformConfigDir("forgecode", context.destBase, context.userHome);
  const targetMcp = join(targetForgeDir, ".mcp.json");

  logHeader(context, `Installing ${PLATFORM_LABELS.forgecode}`);
  backupDirectory(targetForgeDir, context);
  backupFile(targetMcp, context);
  const preservedConfigs = capturePlatformPreservedNativeConfigs("forgecode", context);
  ensureDir(targetForgeDir);
  writePlatformPreservedNativeConfigs("forgecode", preservedConfigs, context);

  if (existsSync(sourceForgeDir)) {
    copyPlatformContents(sourceForgeDir, targetForgeDir, {
      logger: context.logger,
      skipNames: PLATFORM_INSTALL_SKIP_NAMES.forgecode,
      namedDirectories: managedDirectoryRules("forgecode"),
    });
  }

  copyPlatformContents(sourceDir, targetForgeDir, {
    logger: context.logger,
    skipNames: reservedNames(
      ...PLATFORM_INSTALL_SKIP_NAMES.forgecode,
      resolvePlatformDirSegment(PLATFORM_DIRS.forgecode.project),
    ),
  });
}

export function detectInstallCollisions(
  destBase: string,
  targets: readonly Platform[],
  userHome: string = homedir(),
): string[] {
  const paths = new Set<string>();
  for (const platform of targets) {
    for (const path of detectPlatformCollisions(platform, destBase, userHome)) {
      paths.add(path);
    }
  }
  return [...paths];
}

function detectPlatformCollisions(platform: Platform, destBase: string, userHome: string): readonly string[] {
  switch (platform) {
    case "claude":
      return detectClaudeCollisions(destBase, userHome);
    case "forgecode":
      return detectForgecodeCollisions(destBase, userHome);
    case "codex":
    case "cursor":
    case "opencode":
      return detectPlatformDirCollisions(platform, destBase, userHome);
  }
}

function detectClaudeCollisions(destBase: string, userHome: string): readonly string[] {
  const paths: string[] = [];
  const rootConfigPath = isSamePath(destBase, userHome) ? join(destBase, ".claude.json") : join(destBase, ".mcp.json");
  if (existsSync(rootConfigPath)) {
    paths.push(rootConfigPath);
  }

  const platformDir = collisionPlatformDir("claude", destBase, userHome);
  if (isNonEmptyDirectory(platformDir)) {
    paths.push(platformDir);
  }
  return paths;
}

function detectForgecodeCollisions(destBase: string, userHome?: string): readonly string[] {
  const paths: string[] = [];
  const forgeDir = collisionPlatformDir("forgecode", destBase, userHome);
  if (isNonEmptyDirectory(forgeDir)) {
    paths.push(forgeDir);
  }

  const mcpPath = join(forgeDir, ".mcp.json");
  if (existsSync(mcpPath)) {
    paths.push(mcpPath);
  }
  return paths;
}

function detectPlatformDirCollisions(platform: Platform, destBase: string, userHome?: string): readonly string[] {
  const platformDir = collisionPlatformDir(platform, destBase, userHome);
  return isNonEmptyDirectory(platformDir) ? [platformDir] : [];
}

function collisionPlatformDir(platform: Platform, destBase: string, userHome?: string): string {
  return platformConfigDir(platform, destBase, userHome);
}

function isNonEmptyDirectory(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  try {
    return readDirectoryEntries(path).length > 0;
  } catch {
    return false;
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

function warnLegacyOpencodeDirectories(context: InstallContext): void {
  if (!isSamePath(context.destBase, context.userHome)) return;

  const targetDir = platformConfigDir("opencode", context.userHome, context.userHome);
  for (const legacyDir of [join(context.userHome, "opencode"), join(context.userHome, ".opencode")]) {
    if (existsSync(join(legacyDir, ULIS_MANIFEST_FILENAME))) {
      context.logger?.warn(
        `Legacy OpenCode directory found at ${legacyDir}. Move its contents to ${targetDir} or remove it.`,
      );
    }
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
    // Same treatment the parse error gets above: a diagnosable message reaches the user intact.
    if (error instanceof UnsafeNativeConfigPathError) throw new InstallError(error.message, error);
    throw new InstallError(`Failed to write preserved native config for ${platform}`, error);
  }
}

function backupDirectory(targetDir: string, context: InstallContext): void {
  if (!context.backup || !existsSync(targetDir)) {
    return;
  }

  logInfo(context, `[backup] ${targetDir} -> ${copyToUnusedBackupPath(targetDir, context)}`);
}

function backupFile(targetPath: string, context: InstallContext): void {
  if (!context.backup || !existsSync(targetPath)) {
    return;
  }

  logInfo(context, `[backup] ${targetPath} -> ${copyToUnusedBackupPath(targetPath, context)}`);
}

/**
 * Copy `sourcePath` to the first backup name nothing is using, and return it.
 *
 * Never to a name already taken: the timestamp resolves to the second, so two installs moments
 * apart compute the same one, and overwriting would delete the earlier backup - or, for a name that
 * happened to exist already, whatever was there. `copyToNewPath` also refuses to write through a
 * symbolic link, which this predictable name is otherwise a fine place to plant.
 */
function copyToUnusedBackupPath(sourcePath: string, context: InstallContext): string {
  for (let attempt = 1; attempt <= MAX_BACKUP_ATTEMPTS; attempt += 1) {
    const candidate = backupPath(sourcePath, context.timestamp, attempt);
    if (copyToNewPath(sourcePath, candidate)) return candidate;
  }
  throw new InstallError(
    `Found no unused backup path for ${sourcePath} after ${MAX_BACKUP_ATTEMPTS} attempts. Remove some of its .backup copies and retry.`,
  );
}

function reservedNames(...names: readonly string[]): ReadonlySet<string> {
  return new Set([ULIS_MANIFEST_FILENAME, ULIS_PROVENANCE_FILENAME, ...names]);
}

function managedDirectoryRules(platform: Platform) {
  const categories = MANAGED_PLATFORM_LAYOUTS[platform].agentDirectories.filter(Boolean);
  return {
    agents: categories.length > 0 ? { alternateRelativeDirs: categories } : {},
    skills: {},
  };
}

function logHeader(context: InstallContext, message: string): void {
  context.logger?.header(message);
}

function logInfo(context: InstallContext, message: string): void {
  context.logger?.info(message);
}

function logSuccess(context: InstallContext, message: string): void {
  context.logger?.success(message);
}
