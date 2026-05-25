import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { Logger } from "../build.js";
import { InstallError } from "./errors.js";

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
    logger?.success(entry);
  }
}
