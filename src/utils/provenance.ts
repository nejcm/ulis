import { renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

import { ULIS_PROVENANCE_FILENAME } from "../config.js";
import { InstallError } from "../install/errors.js";
import type { Platform } from "../platforms.js";
import { ensureDir, fileExists, readFile } from "./fs.js";
import { redactUserinfo } from "./redact.js";

export interface ProvenanceMarker {
  readonly version: 1;
  readonly remoteSources: readonly string[];
}

function markerPath(platformOutDir: string): string {
  return join(platformOutDir, ULIS_PROVENANCE_FILENAME);
}

function parseMarker(contents: string): ProvenanceMarker | undefined {
  const value = JSON.parse(contents) as unknown;
  // JSON arrays cannot carry a version property, but reject them here to enforce the object contract
  // before inspecting marker fields.
  if (value == null || typeof value !== "object" || Array.isArray(value)) return undefined;

  const marker = value as Partial<ProvenanceMarker>;
  if (marker.version !== 1) return undefined;
  if (!Array.isArray(marker.remoteSources) || !marker.remoteSources.every((url) => typeof url === "string")) {
    return undefined;
  }
  return marker as ProvenanceMarker;
}

/**
 * Write `contents` to `path` atomically: a same-directory temp file plus `rename`, which POSIX
 * guarantees is atomic, so no reader ever observes a half-written file. Without this, a build
 * killed mid-write (`kill -9`, disk full) could leave the provenance reader looking at truncated
 * JSON for entries the write never actually touched. This is not a durability guarantee across
 * hard power loss (there is no `fsync`): it only ensures a reader sees either the old complete file
 * or the new one, never a torn one. The temp file is removed on any failure.
 */
function writeAtomic(path: string, contents: string): void {
  ensureDir(dirname(path));
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    writeFileSync(tmpPath, contents, "utf-8");
    renameSync(tmpPath, path);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
}

export function writeProvenanceMarker(platformOutDir: string, remoteUrls: readonly string[]): void {
  const remoteSources = [...new Set(remoteUrls.map(redactUserinfo))].sort();
  if (remoteSources.length === 0) return;

  const marker: ProvenanceMarker = { version: 1, remoteSources };
  writeAtomic(markerPath(platformOutDir), `${JSON.stringify(marker, null, 2)}\n`);
}

export function readRecordedRemoteSources(outputDir: string, platforms: readonly Platform[]): readonly string[] {
  const urls = new Set<string>();

  for (const platform of platforms) {
    const path = markerPath(join(outputDir, platform));
    if (!fileExists(path)) continue;

    let marker: ProvenanceMarker | undefined;
    try {
      marker = parseMarker(readFile(path));
    } catch (error) {
      throw unreadableMarkerError(platform, path, error);
    }
    if (!marker) throw unreadableMarkerError(platform, path);
    for (const url of marker.remoteSources) urls.add(url);
  }

  return [...urls];
}

function unreadableMarkerError(platform: Platform, path: string, cause?: unknown): InstallError {
  return new InstallError(
    `Could not read the provenance record for ${platform} at ${path}. It may be truncated by an interrupted write or written by a newer ULIS. ` +
      `Rebuild that platform (\`ulis build --target ${platform}\`) to recreate it, or delete the file if you accept losing its remote-source history.`,
    cause,
  );
}

export function isProvenanceMarkerPath(relativePath: string): boolean {
  return normalize(relativePath).replaceAll("\\", "/").toLowerCase() === ULIS_PROVENANCE_FILENAME;
}

export function legacyRootRecordPath(outputDir: string): string {
  return join(outputDir, ULIS_PROVENANCE_FILENAME);
}
