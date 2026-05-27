import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  PLATFORM_DIRS,
  PLATFORM_LABELS,
  platformConfigDir,
  resolvePlatformDirSegment,
  type Platform,
} from "../platforms.js";
import {
  capturePreservedNativeConfigs,
  PreservedNativeConfigParseError,
  writePreservedNativeConfigs,
  type CapturedPreservedNativeConfig,
} from "../utils/config-merger.js";
import { InstallError } from "./errors.js";
import { backupPath, copyPath, copyPlatformContents, ensureDir, readDirectoryEntries } from "./fs.js";
import type { InstallContext } from "./types.js";

const AGENT_SKILL_DIRS = { agents: {}, skills: {} };
const OPENCODE_AGENT_SKILL_DIRS = {
  agents: { alternateRelativeDirs: ["core", "specialized"] },
  skills: {},
};

export async function installOpencode(context: InstallContext): Promise<void> {
  const targetDir = platformConfigDir("opencode", context.destBase, context.userHome);
  const sourceDir = join(context.outputDir, "opencode");

  logHeader(context, `Installing ${PLATFORM_LABELS.opencode}`);
  backupDirectory(targetDir, context);
  const preservedConfigs = capturePlatformPreservedNativeConfigs("opencode", context);

  copyPlatformContents(sourceDir, targetDir, {
    logger: context.logger,
    namedDirectories: OPENCODE_AGENT_SKILL_DIRS,
    pruneExtraNames: true,
  });
  writePlatformPreservedNativeConfigs("opencode", preservedConfigs, context);
  logSuccess(context, `OpenCode -> ${targetDir}`);
}

export async function installClaude(context: InstallContext): Promise<void> {
  const targetDir = platformConfigDir("claude", context.destBase, context.userHome);
  const sourceDir = join(context.outputDir, "claude");
  const targetRootConfig = context.globalInstall
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
    skipNames: new Set(["settings.json", ".claude.json"]),
    namedDirectories: AGENT_SKILL_DIRS,
  });
}

export async function installCodex(context: InstallContext): Promise<void> {
  const targetDir = platformConfigDir("codex", context.destBase, context.userHome);
  const sourceDir = join(context.outputDir, "codex");

  logHeader(context, `Installing ${PLATFORM_LABELS.codex}`);
  backupDirectory(targetDir, context);
  const preservedConfigs = capturePlatformPreservedNativeConfigs("codex", context);
  ensureDir(targetDir);
  copyPlatformContents(sourceDir, targetDir, {
    logger: context.logger,
    skipNames: new Set(["config.toml"]),
    namedDirectories: AGENT_SKILL_DIRS,
  });
  writePlatformPreservedNativeConfigs("codex", preservedConfigs, context);
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
    skipNames: new Set(["mcp.json"]),
    namedDirectories: AGENT_SKILL_DIRS,
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

  if (existsSync(sourceForgeDir)) {
    copyPlatformContents(sourceForgeDir, targetForgeDir, {
      logger: context.logger,
      skipNames: new Set([".mcp.json"]),
      namedDirectories: AGENT_SKILL_DIRS,
    });
  }

  copyPlatformContents(sourceDir, targetForgeDir, {
    logger: context.logger,
    skipNames: new Set([resolvePlatformDirSegment(PLATFORM_DIRS.forgecode.project), ".forge.toml"]),
  });

  writePlatformPreservedNativeConfigs("forgecode", preservedConfigs, context);
}

export function detectInstallCollisions(
  destBase: string,
  targets: readonly Platform[],
  globalInstall: boolean,
  userHome?: string,
): string[] {
  const paths = new Set<string>();
  for (const platform of targets) {
    for (const path of detectPlatformCollisions(platform, destBase, globalInstall, userHome)) {
      paths.add(path);
    }
  }
  return [...paths];
}

function detectPlatformCollisions(
  platform: Platform,
  destBase: string,
  globalInstall: boolean,
  userHome?: string,
): readonly string[] {
  switch (platform) {
    case "claude":
      return detectClaudeCollisions(destBase, globalInstall, userHome);
    case "forgecode":
      return detectForgecodeCollisions(destBase, userHome);
    case "codex":
    case "cursor":
    case "opencode":
      return detectPlatformDirCollisions(platform, destBase, userHome);
  }
}

function detectClaudeCollisions(destBase: string, globalInstall: boolean, userHome?: string): readonly string[] {
  const paths: string[] = [];
  const rootConfigPath = globalInstall ? join(destBase, ".claude.json") : join(destBase, ".mcp.json");
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

  const targetBackupPath = backupPath(targetDir, context.timestamp);
  copyPath(targetDir, targetBackupPath);
  logInfo(context, `[backup] ${targetDir} -> ${targetBackupPath}`);
}

function backupFile(targetPath: string, context: InstallContext): void {
  if (!context.backup || !existsSync(targetPath)) {
    return;
  }

  const targetBackupPath = backupPath(targetPath, context.timestamp);
  copyPath(targetPath, targetBackupPath);
  logInfo(context, `[backup] ${targetPath} -> ${targetBackupPath}`);
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
