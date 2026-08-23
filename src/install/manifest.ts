import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative } from "node:path";

import type { Logger } from "../build.js";
import { ULIS_PROVENANCE_FILENAME } from "../config.js";
import { platformConfigDir, type Platform } from "../platforms.js";
import { InstallError } from "./errors.js";
import { ensureDir, filesystemIdentity, removePath } from "./fs.js";
import { MANAGED_PLATFORM_LAYOUTS, type ManagedPlatformLayout } from "./layouts.js";

export const ULIS_MANIFEST_FILENAME = ".ulis-manifest.json";
/**
 * 3 records root entries as the individual files an install writes. Version 2 recorded root
 * *names*, which made the sweep remove a whole subtree - including files the user had put inside
 * a directory a previous install created. A version 2 manifest is still read; the sweep degrades
 * to removing a recorded directory only when it is already empty, and the run rewrites it as 3.
 */
const MANIFEST_VERSION = 3;

/** Names an install writes itself and never copies, so they are not the destination's to own. */
const RESERVED_ROOT_NAMES: ReadonlySet<string> = new Set([ULIS_MANIFEST_FILENAME, ULIS_PROVENANCE_FILENAME]);

/** Recorded above at their own granularity, so the root listing must not claim them again. */
const SEPARATELY_MANAGED_ROOT_NAMES: ReadonlySet<string> = new Set(["agents", "skills"]);

export interface OwnershipManifest {
  readonly version: 1 | 2 | typeof MANIFEST_VERSION;
  readonly agents: readonly string[];
  readonly skills: readonly string[];
  readonly rootEntries: readonly string[] | undefined;
}

export interface PlatformOwnership {
  readonly targetDir: string;
  readonly previous?: OwnershipManifest;
  readonly current: OwnershipManifest;
}

export function preflightOwnership(
  platforms: readonly Platform[],
  outputDir: string,
  destBase: string,
  userHome: string,
  prune: boolean,
): ReadonlyMap<Platform, PlatformOwnership> {
  const ownership = new Map<Platform, PlatformOwnership>();
  for (const platform of platforms) {
    const targetDir = platformConfigDir(platform, destBase, userHome);
    ownership.set(platform, {
      targetDir,
      previous: readManifest(platform, targetDir),
      current: collectGeneratedManifest(platform, outputDir),
    });
  }
  for (const [platform, entry] of ownership) validateManagedDestinations(platform, entry, prune);
  return ownership;
}

export function reconcileOwnership(
  platform: Platform,
  ownership: PlatformOwnership,
  prune: boolean,
  logger?: Logger,
): void {
  let summary: string;
  if (!ownership.previous) {
    summary = "adopted generated agents and skills; nothing pruned";
  } else if (!prune) {
    summary = "pruning disabled; stale entries are now unmanaged";
  } else {
    const pruned = pruneStaleEntries(platform, ownership, logger);
    summary = `manifest updated; ${pruned} stale ${pruned === 1 ? "entry" : "entries"} pruned`;
  }

  writeManifestAtomic(ownership.targetDir, ownership.current);
  logger?.info(`[ownership] ${platform}: ${summary}`);
}

function readManifest(platform: Platform, targetDir: string): OwnershipManifest | undefined {
  const manifestPath = join(targetDir, ULIS_MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) return;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new InstallError(`Invalid ULIS ownership manifest for ${platform} at ${manifestPath}`, error);
  }

  if (!isRecord(raw) || (raw.version !== 1 && raw.version !== 2 && raw.version !== MANIFEST_VERSION)) {
    const version = isRecord(raw) ? String(raw.version) : "missing";
    throw new InstallError(
      `Unsupported ULIS ownership manifest for ${platform} at ${manifestPath}: expected version 1, 2 or ${MANIFEST_VERSION}, received ${version}`,
    );
  }
  if (!Array.isArray(raw.agents) || !Array.isArray(raw.skills)) {
    throw new InstallError(`Invalid ULIS ownership manifest for ${platform} at ${manifestPath}: expected arrays`);
  }
  if (raw.version !== 1 && !Array.isArray(raw.rootEntries)) {
    throw new InstallError(
      `Invalid ULIS ownership manifest for ${platform} at ${manifestPath}: expected rootEntries array`,
    );
  }

  const agents = validatePaths(platform, "agents", raw.agents, manifestPath);
  const skills = validatePaths(platform, "skills", raw.skills, manifestPath);
  const rootEntries =
    raw.version === 1 ? undefined : validateRootEntries(raw.rootEntries as readonly unknown[], manifestPath);
  return { version: raw.version, agents, skills, rootEntries };
}

function collectGeneratedManifest(platform: Platform, outputDir: string): OwnershipManifest {
  const platformOutput = join(outputDir, platform);
  const layout = MANAGED_PLATFORM_LAYOUTS[platform];
  const nativeRoot = join(platformOutput, ...layout.nativeRoot);
  const agents = layout.agentDirectories.flatMap((category) => {
    const relativeDir = category ? `agents/${category}` : "agents";
    return listNames(join(nativeRoot, ...relativeDir.split("/")), "file").map((name) => `${relativeDir}/${name}`);
  });
  const skills = listNames(join(nativeRoot, "skills"), "directory").map((name) => `skills/${name}`);

  return {
    version: MANIFEST_VERSION,
    agents: validatePaths(platform, "agents", agents, platformOutput),
    skills: validatePaths(platform, "skills", skills, platformOutput),
    rootEntries: validateRootEntries(listManagedRootFiles(platformOutput, layout), platformOutput),
  };
}

/**
 * The files this install writes into the platform's destination root, relative to that root.
 *
 * Read off the same roots the copy passes use, not off the generated platform directory's own
 * listing: ForgeCode's destination root is fed by two passes - its native `.forge/` root and the
 * outer tree minus that root - so listing the outer tree alone recorded `.forge` itself, a name
 * that never exists in the destination.
 */
function listManagedRootFiles(platformOutput: string, layout: ManagedPlatformLayout): string[] {
  const files = listRootFiles(join(platformOutput, ...layout.nativeRoot), "", SEPARATELY_MANAGED_ROOT_NAMES);
  if (layout.nativeRoot.length > 0) {
    const outerSkip = new Set([...SEPARATELY_MANAGED_ROOT_NAMES, layout.nativeRoot[0]!]);
    files.push(...listRootFiles(platformOutput, "", outerSkip));
  }
  return files;
}

function listRootFiles(dirPath: string, prefix: string, skipNames: ReadonlySet<string>): string[] {
  if (!existsSync(dirPath)) return [];
  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch (error) {
    throw new InstallError(`Failed to inspect generated root entries at ${dirPath}`, error);
  }

  const files: string[] = [];
  for (const entry of entries) {
    // Only the top level is skippable: the copy passes match these names at the root too, and a
    // nested file that happens to share one is still ours.
    if (!prefix && (isSkipped(skipNames, entry.name) || isSkipped(RESERVED_ROOT_NAMES, entry.name))) continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    // A symlink is recorded as the entry it is; the sweep removes the link, never its target.
    if (entry.isDirectory()) files.push(...listRootFiles(join(dirPath, entry.name), relativePath, skipNames));
    else files.push(relativePath);
  }
  return files;
}

function isSkipped(names: ReadonlySet<string>, candidate: string): boolean {
  const normalized = candidate.toLowerCase();
  return [...names].some((name) => name.toLowerCase() === normalized);
}

/**
 * A root entry is a path relative to the platform's destination root: one file for version 3, a
 * bare name for a version 2 manifest. `..`, absolute paths and backslashes are refused so a
 * hand-edited manifest cannot aim the sweep outside that root; containment past the first segment
 * rests on the sweep refusing to walk through a symlink.
 */
function validateRootEntries(values: readonly unknown[], sourcePath: string): string[] {
  const entries: string[] = [];
  for (const value of values) {
    if (
      typeof value !== "string" ||
      !value ||
      value.startsWith("/") ||
      value.includes("\\") ||
      value.includes("\0") ||
      value.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      throw new InstallError(`Unsafe root entry in ULIS ownership data at ${sourcePath}: ${String(value)}`);
    }
    entries.push(value);
  }
  return [...new Set(entries)].sort();
}

function listNames(dirPath: string, expectedType: "file" | "directory"): string[] {
  if (!existsSync(dirPath)) return [];
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .map((entry) => {
        const valid = expectedType === "file" ? entry.isFile() : entry.isDirectory();
        if (!valid) {
          throw new InstallError(`Expected generated ${expectedType} at ${join(dirPath, entry.name)}`);
        }
        return entry.name;
      })
      .sort();
  } catch (error) {
    if (error instanceof InstallError) throw error;
    throw new InstallError(`Failed to inspect generated ownership entries at ${dirPath}`, error);
  }
}

function validatePaths(
  platform: Platform,
  kind: "agents" | "skills",
  values: readonly unknown[],
  sourcePath: string,
): string[] {
  const paths: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !isAllowedManagedPath(platform, kind, value)) {
      throw new InstallError(
        `Unsafe ${kind.slice(0, -1)} path in ULIS ownership data for ${platform} at ${sourcePath}: ${String(value)}`,
      );
    }
    paths.push(value);
  }
  return [...new Set(paths)].sort();
}

function isAllowedManagedPath(platform: Platform, kind: "agents" | "skills", value: string): boolean {
  if (!value || value.includes("\\") || value.includes("\0") || value.startsWith("/")) {
    return false;
  }

  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return false;
  if (kind === "skills") return parts.length === 2 && parts[0] === "skills";

  const layout = MANAGED_PLATFORM_LAYOUTS[platform];
  if (!value.endsWith(layout.agentExtension) || parts[0] !== "agents") return false;
  const category = parts.length === 3 ? parts[1] : "";
  return parts.length === (category ? 3 : 2) && layout.agentDirectories.includes(category);
}

function pruneStaleEntries(platform: Platform, ownership: PlatformOwnership, logger?: Logger): number {
  const current = new Set([...ownership.current.agents, ...ownership.current.skills]);
  const currentIdentities = new Set(
    [...current].flatMap((relativePath) => {
      const identity = filesystemIdentity(join(ownership.targetDir, ...relativePath.split("/")));
      return identity ? [identity] : [];
    }),
  );
  let pruned = 0;
  for (const relativePath of [...ownership.previous!.agents, ...ownership.previous!.skills]) {
    if (current.has(relativePath)) continue;
    const targetPath = join(ownership.targetDir, ...relativePath.split("/"));
    const identity = filesystemIdentity(targetPath);
    if (identity && currentIdentities.has(identity)) continue;
    removePath(targetPath);
    logger?.info(`[prune] ${platform}: ${relativePath}`);
    pruned += 1;
  }
  return pruned;
}

function writeManifestAtomic(targetDir: string, manifest: OwnershipManifest): void {
  ensureDir(targetDir);
  const manifestPath = join(targetDir, ULIS_MANIFEST_FILENAME);
  const temporaryPath = join(targetDir, `${ULIS_MANIFEST_FILENAME}.${process.pid}.${Date.now().toString(36)}.tmp`);
  try {
    // `wx`: exclusive create, so a symlink planted at the temporary path is refused rather than
    // written through. The name carries a pid and a timestamp, which makes it hard to guess but not
    // impossible to observe.
    writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temporaryPath, manifestPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw new InstallError(`Failed to write ULIS ownership manifest at ${manifestPath}`, error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateManagedDestinations(platform: Platform, ownership: PlatformOwnership, prune: boolean): void {
  if (!existsSync(ownership.targetDir)) return;
  const targetRoot = realpathSync.native(ownership.targetDir);
  const current = [...ownership.current.agents, ...ownership.current.skills];
  for (const relativePath of current) {
    validateManagedDestination(platform, ownership.targetDir, targetRoot, relativePath);
  }
  if (!prune || !ownership.previous) return;

  const currentPaths = new Set(current);
  for (const relativePath of [...ownership.previous.agents, ...ownership.previous.skills]) {
    if (!currentPaths.has(relativePath)) {
      validateManagedDestination(platform, ownership.targetDir, targetRoot, relativePath);
    }
  }
}

function validateManagedDestination(
  platform: Platform,
  targetDir: string,
  targetRoot: string,
  relativePath: string,
): void {
  let candidate = targetDir;
  for (const part of relativePath.split("/")) {
    candidate = join(candidate, part);
    let stats;
    try {
      stats = lstatSync(candidate);
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw new InstallError(`Failed to inspect managed path for ${platform}: ${candidate}`, error);
    }
    if (stats.isSymbolicLink()) {
      throw new InstallError(`Unsafe managed path for ${platform}: ${candidate} is a symbolic link`);
    }
    const resolvedCandidate = realpathSync.native(candidate);
    const relativeCandidate = relative(targetRoot, resolvedCandidate);
    if (
      relativeCandidate === ".." ||
      relativeCandidate.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(relativeCandidate)
    ) {
      throw new InstallError(`Managed path escapes the ${platform} config root: ${candidate}`);
    }
  }

  const stats = lstatSync(candidate);
  const expectedType = relativePath.startsWith("agents/") ? "file" : "directory";
  const validType = expectedType === "file" ? stats.isFile() : stats.isDirectory();
  if (!validType) {
    throw new InstallError(`Unsafe managed ${expectedType} for ${platform}: ${candidate}`);
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
