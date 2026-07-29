import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { Logger } from "../build.js";
import { InstallError } from "./errors.js";

export interface NamedDirectoryCopyRule {
  readonly alternateRelativeDirs?: readonly string[];
}

export interface CopyPlatformContentsOptions {
  readonly logger?: Logger;
  readonly skipNames?: ReadonlySet<string>;
  readonly namedDirectories?: Readonly<Record<string, NamedDirectoryCopyRule>>;
  readonly pruneExtraNames?: boolean;
}

export function backupPath(targetPath: string, timestamp: string): string {
  return `${targetPath}.${timestamp}.backup`;
}

export function ensureDir(dirPath: string): void {
  try {
    mkdirSync(dirPath, { recursive: true });
  } catch (error) {
    throw new InstallError(`Failed to create directory: ${dirPath}`, error);
  }
}

export function readDirectoryEntries(dirPath: string): readonly string[] {
  try {
    return readdirSync(dirPath);
  } catch (error) {
    throw new InstallError(`Failed to list directory: ${dirPath}`, error);
  }
}

export function removePath(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (error) {
    throw new InstallError(`Failed to remove path: ${path}`, error);
  }
}

export function copyPath(sourcePath: string, targetPath: string): void {
  try {
    cpSync(sourcePath, targetPath, { recursive: true });
  } catch (error) {
    throw new InstallError(`Failed to copy ${sourcePath} -> ${targetPath}`, error);
  }
}

export function copyPlatformContents(
  sourceDir: string,
  targetDir: string,
  options: CopyPlatformContentsOptions = {},
): void {
  const { logger, skipNames = new Set(), namedDirectories = {}, pruneExtraNames = false } = options;
  ensureDir(targetDir);
  if (!existsSync(sourceDir)) {
    throw new InstallError(`Generated platform directory does not exist: ${sourceDir}`);
  }

  const entries = readDirectoryEntries(sourceDir);
  if (pruneExtraNames) {
    pruneExtraTargetEntries(targetDir, entries, skipNames, namedDirectories);
  }

  for (const entry of entries) {
    if (hasName(skipNames, entry)) {
      continue;
    }

    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, entry);
    const namedDirectory = findNamedDirectory(namedDirectories, entry);
    if (namedDirectory) {
      copyNamedDirectory(sourcePath, targetPath, namedDirectory, logger);
      logger?.success(entry);
      continue;
    }

    removePath(targetPath);
    copyPath(sourcePath, targetPath);
    logger?.success(entry);
  }
}

function pruneExtraTargetEntries(
  targetDir: string,
  sourceEntries: readonly string[],
  skipNames: ReadonlySet<string>,
  namedDirectories: Readonly<Record<string, NamedDirectoryCopyRule>>,
): void {
  const sourceNames = new Set(sourceEntries);
  for (const targetEntry of readDirectoryEntries(targetDir)) {
    if (
      hasName(sourceNames, targetEntry) ||
      hasName(skipNames, targetEntry) ||
      findNamedDirectory(namedDirectories, targetEntry)
    ) {
      continue;
    }

    removePath(join(targetDir, targetEntry));
  }
}

function hasName(names: ReadonlySet<string>, candidate: string): boolean {
  const normalized = candidate.toLowerCase();
  return [...names].some((name) => name.toLowerCase() === normalized);
}

function findNamedDirectory(
  directories: Readonly<Record<string, NamedDirectoryCopyRule>>,
  candidate: string,
): NamedDirectoryCopyRule | undefined {
  const normalized = candidate.toLowerCase();
  const key = Object.keys(directories).find((name) => name.toLowerCase() === normalized);
  return key ? directories[key] : undefined;
}

function copyNamedDirectory(sourceDir: string, targetDir: string, rule: NamedDirectoryCopyRule, logger?: Logger): void {
  ensureDir(targetDir);
  if (rule.alternateRelativeDirs && rule.alternateRelativeDirs.length > 0) {
    copyNestedNamedDirectory(sourceDir, targetDir, rule, logger);
    return;
  }

  const entries = readDirectoryEntries(sourceDir);
  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, entry);
    removePath(targetPath);
    copyPath(sourcePath, targetPath);
    logger?.dim(`  ${entry}`);
  }
}

function copyNestedNamedDirectory(
  sourceDir: string,
  targetDir: string,
  rule: NamedDirectoryCopyRule,
  logger?: Logger,
): void {
  for (const relativeDir of rule.alternateRelativeDirs ?? []) {
    const sourceNestedDir = join(sourceDir, relativeDir);
    if (!existsSync(sourceNestedDir)) {
      continue;
    }

    const targetNestedDir = join(targetDir, relativeDir);
    ensureDir(targetNestedDir);
    for (const entry of readDirectoryEntries(sourceNestedDir)) {
      const sourcePath = join(sourceNestedDir, entry);
      const targetPath = join(targetNestedDir, entry);
      removePath(targetPath);
      copyPath(sourcePath, targetPath);
      logger?.dim(`  ${relativeDir}/${entry}`);
    }
  }
}
