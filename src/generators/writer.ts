import { isAbsolute, join, relative, resolve } from "node:path";

import type { Platform } from "../platforms.js";
import { mergeOrCopyDir } from "../utils/config-merger.js";
import { cleanDir, copyDir, copySkillDirs, fileExists, readFile, writeAgentsAliases, writeFile } from "../utils/fs.js";
import { logger as log } from "../utils/logger.js";
import type { GenerationResult } from "./types.js";

/**
 * Apply a pure `GenerationResult` to disk under `outDir`:
 * 1. Clear the out dir.
 * 2. Write each `FileArtifact` (path is resolved relative to `outDir`).
 * 3. Copy skill directories, merge raw source trees, and write AGENTS.md aliases.
 *
 * Pure generation (the `artifacts` array) is byte-for-byte reproducible and
 * snapshot-testable. This function owns the only filesystem side effects.
 */
export function writeResult(result: GenerationResult, outDir: string, platform: Platform): void {
  cleanDir(outDir);

  for (const artifact of result.artifacts) {
    writeFile(resolveArtifactPath(outDir, artifact.path), artifact.contents as string);
  }

  if (result.post.skillDirs.length > 0) {
    const skillsDest = result.post.skillsDestRelative ?? "skills";
    copySkillDirs(result.post.skillDirs, join(outDir, skillsDest));
    log.success(`${skillsDest}/ (${result.post.skillDirs.length} copied)`);
  }

  for (const copy of result.post.copyDirs ?? []) {
    if (!fileExists(copy.src)) continue;
    copyDir(copy.src, join(outDir, copy.destRelative));
    log.dim(`  copied: ${copy.destRelative}`);
  }

  for (const rawDir of result.post.rawDirs) {
    if (!fileExists(rawDir)) continue;
    mergeOrCopyDir(rawDir, outDir);
    log.dim(`  merged: ${rawDir}`);
  }

  for (const append of result.post.appendAfterRaw ?? []) {
    const fullPath = join(outDir, append.path);
    const existing = fileExists(fullPath) ? readFile(fullPath).trimEnd() + "\n\n" : "";
    writeFile(fullPath, existing + append.content);
    log.dim(`  appended: ${append.path}`);
  }

  if (result.post.aliasFiles.length > 0) {
    const aliases = writeAgentsAliases(outDir, result.post.aliasFiles);
    for (const alias of aliases) log.success(alias);
  }

  log.success(`${platform}: ${result.artifacts.length} artifact(s) written`);
}

function resolveArtifactPath(outDir: string, artifactPath: string): string {
  if (isAbsolute(artifactPath) || /^[A-Za-z]:[\\/]/u.test(artifactPath)) {
    throw new Error(`Refusing to write absolute artifact path: ${artifactPath}`);
  }

  const root = resolve(outDir);
  const target = resolve(root, artifactPath);
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..\\`) || rel.startsWith("../") || isAbsolute(rel)) {
    throw new Error(`Refusing to write artifact outside output directory: ${artifactPath}`);
  }

  return target;
}
