import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, extname, join } from "node:path";

import type { Logger } from "../build.js";
import { InstallError } from "./errors.js";

export interface NamedDirectoryCopyRule {
  readonly alternateRelativeDirs?: readonly string[];
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
  logger?: Logger,
  skipNames: ReadonlySet<string> = new Set(),
  namedDirectories: Readonly<Record<string, NamedDirectoryCopyRule>> = {},
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
    const namedDirectory = namedDirectories[entry];
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
    removeMatchingNamedEntries(targetDir, entry, rule);
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
      removeMatchingNamedEntries(targetDir, entry, rule);
      removePath(targetPath);
      copyPath(sourcePath, targetPath);
      logger?.dim(`  ${relativeDir}/${entry}`);
    }
  }
}

function removeMatchingNamedEntries(targetDir: string, entry: string, rule: NamedDirectoryCopyRule): void {
  const entryBaseName = basename(entry, extname(entry));
  for (const relativeDir of rule.alternateRelativeDirs ?? []) {
    const alternateTargetDir = join(targetDir, relativeDir);
    if (!existsSync(alternateTargetDir)) {
      continue;
    }

    for (const alternateEntry of readDirectoryEntries(alternateTargetDir)) {
      if (basename(alternateEntry, extname(alternateEntry)) === entryBaseName) {
        removePath(join(alternateTargetDir, alternateEntry));
      }
    }
  }
}
