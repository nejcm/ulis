import { isAbsolute, join, relative, resolve } from "node:path";

import type { Logger } from "../build.js";
import type { Platform } from "../platforms.js";
import { mergeOrCopyDir } from "../utils/config-merge.js";
import { cleanDir, copyDir, copySkillDirs, fileExists, readFile, writeAgentsAliases, writeFile } from "../utils/fs.js";
import { logger as defaultLogger } from "../utils/logger.js";
import { isProvenanceMarkerPath, writeProvenanceMarker } from "../utils/provenance.js";
import type { GenerationResult } from "./types.js";

/**
 * Apply a pure `GenerationResult` to disk under `outDir`:
 * 1. Clear the out dir.
 * 2. Write provenance before any remote-authored payload.
 * 3. Copy skill directories.
 * 4. Write each `FileArtifact` (path is resolved relative to `outDir`).
 * 5. Merge raw source trees and write AGENTS.md aliases.
 *
 * Pure generation (the `artifacts` array) is byte-for-byte reproducible and
 * snapshot-testable. This function owns the only filesystem side effects.
 */
export function writeResult(
  result: GenerationResult,
  outDir: string,
  platform: Platform,
  logger: Logger = defaultLogger,
  remoteUrls: readonly string[] = [],
): void {
  cleanDir(outDir);
  // Write the marker before any payload. If generation stops partway through, every remote-authored
  // file already written remains paired with provenance that makes install refuse it.
  if (remoteUrls.length > 0) writeProvenanceMarker(outDir, remoteUrls);

  const copyUnlessReserved = (relativePath: string, prefix = ""): boolean => {
    if (!isProvenanceMarkerPath(join(prefix, relativePath))) return true;
    logger.warn(`Ignored a raw fragment at the reserved provenance path: ${platform}/.ulis-provenance.json`);
    return false;
  };

  if (result.post.skillDirs.length > 0) {
    const skillsDest = result.post.skillsDestRelative ?? "skills";
    copySkillDirs(result.post.skillDirs, join(outDir, skillsDest));
    logger.success(`${skillsDest}/ (${result.post.skillDirs.length} copied)`);
  }

  for (const artifact of result.artifacts) {
    writeFile(resolveArtifactPath(outDir, artifact.path), artifact.contents as string);
  }

  for (const copy of result.post.copyDirs ?? []) {
    if (!fileExists(copy.src)) continue;
    copyDir(copy.src, join(outDir, copy.destRelative), (path) => copyUnlessReserved(path, copy.destRelative));
    logger.dim(`  copied: ${copy.destRelative}`);
  }

  for (const rawDir of result.post.rawDirs) {
    if (!fileExists(rawDir)) continue;
    mergeOrCopyDir(rawDir, outDir, copyUnlessReserved);
    logger.dim(`  merged: ${rawDir}`);
  }

  for (const append of result.post.appendAfterRaw ?? []) {
    const fullPath = join(outDir, append.path);
    const existing = fileExists(fullPath) ? readFile(fullPath).trimEnd() + "\n\n" : "";
    writeFile(fullPath, existing + append.content);
    logger.dim(`  appended: ${append.path}`);
  }

  if (result.post.aliasFiles.length > 0) {
    const aliases = writeAgentsAliases(outDir, result.post.aliasFiles);
    for (const alias of aliases) logger.success(alias);
  }

  logger.success(`${platform}: ${result.artifacts.length} artifact(s) written`);
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
  if (isProvenanceMarkerPath(rel)) {
    throw new Error(`Refusing to write a generated artifact at the reserved provenance path: ${artifactPath}`);
  }

  return target;
}
