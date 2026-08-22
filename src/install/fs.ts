import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  type Stats,
} from "node:fs";
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
  /** Root entries a previous install recorded as its own, relative to `targetDir`. */
  readonly previouslyManagedRootEntries?: readonly string[];
  /** Root entries this install records, in the same shape. The sweep needs both to see a change. */
  readonly currentManagedRootEntries?: readonly string[];
}

/**
 * Name for a backup copy. `attempt` past the first adds a discriminator, because the timestamp is
 * only accurate to the second and two installs that close together would otherwise land on one name.
 */
export function backupPath(targetPath: string, timestamp: string, attempt = 1): string {
  return `${targetPath}.${timestamp}${attempt > 1 ? `-${attempt}` : ""}.backup`;
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
  const {
    logger,
    skipNames = new Set(),
    namedDirectories = {},
    pruneExtraNames = false,
    previouslyManagedRootEntries,
    currentManagedRootEntries,
  } = options;
  ensureDir(targetDir);
  if (!existsSync(sourceDir)) {
    throw new InstallError(`Generated platform directory does not exist: ${sourceDir}`);
  }

  const entries = readDirectoryEntries(sourceDir);
  // No current list means nothing to compare against, and sweeping then would read as "this
  // install owns nothing" - which would remove everything the last one recorded.
  if (pruneExtraNames && currentManagedRootEntries) {
    pruneExtraTargetEntries(
      targetDir,
      currentManagedRootEntries,
      previouslyManagedRootEntries,
      skipNames,
      namedDirectories,
    );
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

    // Merge into an existing destination directory instead of replacing it: the user may have put
    // their own files next to ours inside one, and those were never recorded as ULIS's to remove.
    // The sweep above is what takes out the files a previous install actually wrote.
    copyIntoTarget(sourcePath, targetPath);
    logger?.success(entry);
  }
}

function pruneExtraTargetEntries(
  targetDir: string,
  currentRootEntries: readonly string[],
  previouslyManagedRootEntries: readonly string[] | undefined,
  skipNames: ReadonlySet<string>,
  namedDirectories: Readonly<Record<string, NamedDirectoryCopyRule>>,
): void {
  // Compared exactly, never case-folded. Case-folding makes `commands/Old.md` and `commands/old.md`
  // look like one entry, so on a case-sensitive destination the sweep skipped the old file while
  // the copy wrote the new one beside it - leaving the stale command live. What a case-insensitive
  // destination needs instead is filesystem identity, and it is built lazily: an unchanged tree
  // matches exactly here and pays no `realpath` call at all.
  const current = new Set(currentRootEntries);
  let currentIdentities: ReadonlySet<string> | undefined;
  const identitiesOfCurrent = () =>
    (currentIdentities ??= new Set(
      [...current].flatMap((entry) => {
        const identity = managedRootIdentity(targetDir, entry);
        return identity ? [identity] : [];
      }),
    ));

  const emptiedParents = new Set<string>();
  for (const targetEntry of previouslyManagedRootEntries ?? []) {
    // The skip and named-directory rules match root names, so they are read off the first segment.
    const rootName = targetEntry.split("/")[0]!;
    if (current.has(targetEntry) || hasName(skipNames, rootName) || findNamedDirectory(namedDirectories, rootName)) {
      continue;
    }

    const identity = managedRootIdentity(targetDir, targetEntry);
    if (identity && identitiesOfCurrent().has(identity)) continue;

    if (!removeManagedRootEntry(targetDir, targetEntry)) continue;
    const parts = targetEntry.split("/");
    for (let depth = parts.length - 1; depth > 0; depth -= 1) emptiedParents.add(parts.slice(0, depth).join("/"));
  }

  // Deepest first: a directory only becomes empty once the subdirectories under it are gone.
  for (const parent of [...emptiedParents].sort((left, right) => right.split("/").length - left.split("/").length)) {
    removeManagedRootEntry(targetDir, parent);
  }
}

/**
 * Remove one recorded root entry, and report whether anything went. Recorded paths do not pass
 * `validateManagedDestinations`' realpath containment check, so containment rests here: a
 * symlinked component would relocate the removal outside the platform root, and stops the walk.
 * A recorded directory - which a version 2 manifest is full of - is removed only when it is
 * already empty, because whatever is inside it was never recorded as this install's own.
 */
function removeManagedRootEntry(targetDir: string, relativePath: string): boolean {
  const parts = relativePath.split("/");
  let candidate = targetDir;
  for (const part of parts.slice(0, -1)) {
    candidate = join(candidate, part);
    if (!isRealDirectory(candidate)) return false;
  }

  candidate = join(candidate, parts[parts.length - 1]!);
  const stats = statsOf(candidate);
  if (!stats) return false;
  return stats.isDirectory() ? removeEmptyDirectory(candidate) : unlinkManagedEntry(candidate);
}

/**
 * Remove a recorded directory only when it is empty, and let the filesystem decide that rather than
 * a check of our own. `rmdirSync` is non-recursive: it refuses with ENOTEMPTY instead of deleting,
 * so there is no window between deciding and acting for content to arrive in - a window a recursive
 * `rmSync` behind an emptiness check would have destroyed whatever appeared inside.
 *
 * A non-empty one is left alone and simply stops being recorded, which is the documented migration
 * for a version 2 manifest: it names directories rather than files, and what is inside one was never
 * recorded as this install's own.
 */
function removeEmptyDirectory(dirPath: string): boolean {
  try {
    rmdirSync(dirPath);
    return true;
  } catch (error) {
    // EEXIST rather than ENOTEMPTY on some platforms; both mean the directory still has content.
    if (isErrnoIn(error, MISSING_PATH_CODES) || isErrnoIn(error, NOT_EMPTY_CODES)) return false;
    throw new InstallError(`Failed to remove directory: ${dirPath}`, error);
  }
}

/**
 * Remove a recorded non-directory. `unlinkSync` is the narrow primitive: it removes a symlink as the
 * link and never what it points at, and it refuses a directory outright - so an entry that turned
 * into one after it was inspected aborts the install instead of being deleted with everything now
 * inside it. Only "it is already gone" is absorbed; anything else is a failure to give up ownership
 * over, for the same reason {@link statsOf} does not swallow one.
 */
function unlinkManagedEntry(path: string): boolean {
  try {
    unlinkSync(path);
    return true;
  } catch (error) {
    if (isErrnoIn(error, MISSING_PATH_CODES)) return false;
    throw new InstallError(`Failed to remove path: ${path}`, error);
  }
}

/**
 * Identity of a recorded root path, for telling whether a stale entry and a current one are one
 * directory entry reached by two spellings.
 *
 * Answers only when no component of the path is a symlink. A link resolves to the same `realpath` as
 * its target while being a different entry, so accepting one here would spare the stale file, let
 * the copy replace the link, and then drop the old path from the rewritten manifest - a live file
 * nothing owns. Case-insensitive filesystem aliasing is the only thing this exists for.
 */
function managedRootIdentity(targetDir: string, relativePath: string): string | undefined {
  const parts = relativePath.split("/");
  let candidate = targetDir;
  for (const part of parts.slice(0, -1)) {
    candidate = join(candidate, part);
    if (!isRealDirectory(candidate)) return undefined;
  }

  candidate = join(candidate, parts[parts.length - 1]!);
  return statsOf(candidate)?.isSymbolicLink() ? undefined : filesystemIdentity(candidate);
}

/** Errno values that mean nothing is at this path. ENOTDIR: a component is not a directory. */
const MISSING_PATH_CODES: ReadonlySet<string> = new Set(["ENOENT", "ENOTDIR"]);

/** Errno values `rmdir` reports for a directory that still has something in it. */
const NOT_EMPTY_CODES: ReadonlySet<string> = new Set(["ENOTEMPTY", "EEXIST"]);

/** Errno for an exclusive create losing the path to something already there. `cpSync` uses its own. */
const EXISTS_CODES: ReadonlySet<string> = new Set(["EEXIST", "ERR_FS_CP_EEXIST"]);

/**
 * `lstat`, with "nothing is there" kept separate from "could not look".
 *
 * Every caller decides ownership from the answer, and the manifest is rewritten at the end of the
 * install either way - so reading a permission or I/O error as "already gone" would skip a stale
 * file and drop it from the record in the same breath, leaving a live managed file that no later
 * install can remove. Only the codes that genuinely mean the path does not exist are absorbed;
 * anything else aborts, before ownership is rewritten.
 */
function statsOf(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isErrnoIn(error, MISSING_PATH_CODES)) return undefined;
    throw new InstallError(`Failed to inspect managed path: ${path}`, error);
  }
}

function isErrnoIn(error: unknown, codes: ReadonlySet<string>): boolean {
  return error instanceof Error && "code" in error && typeof error.code === "string" && codes.has(error.code);
}

/**
 * A real directory here, not a symlink pointing at one. The single rule the copy and the sweep both
 * descend by: `lstatSync` does not follow a link, so a symlinked component is never a directory to
 * either of them and neither can be walked through it out of the platform root. One predicate on
 * purpose - two copies of this check are two things that can drift apart.
 */
function isRealDirectory(path: string): boolean {
  return statsOf(path)?.isDirectory() ?? false;
}

/**
 * Canonical path of an existing entry, for deciding whether two managed paths are the same file -
 * a case-only rename on a case-insensitive destination being the case that matters. Lives here
 * rather than beside its other caller in `manifest.ts`, which imports this module, so the sweep and
 * the ownership prune share one implementation instead of a copy each.
 *
 * "Cannot tell" is reported as "not the same file", which on its own would be the fail-open shape
 * {@link statsOf} refuses. It is safe only because neither caller acts on that answer directly: the
 * sweep goes on to {@link removeManagedRootEntry}, and `pruneStaleEntries` to a path that
 * `validateManagedDestinations` already inspected in preflight - both of which abort on an
 * inspection failure rather than treat it as an absent file.
 */
export function filesystemIdentity(path: string): string | undefined {
  if (!existsSync(path)) return;
  try {
    const identity = realpathSync.native(path);
    return process.platform === "win32" ? identity.toLowerCase() : identity;
  } catch {
    return;
  }
}

/**
 * Copy one source entry onto `targetPath`, merging directory into directory and replacing anything
 * else outright.
 *
 * The recursion is what makes the merge safe. `cpSync` walks the destination tree itself and follows
 * a symlink it finds in there, so handing it a directory the user controls would let a link planted
 * anywhere below the platform root relocate the write outside it. Descending one level at a time
 * through {@link isRealDirectory} means it is never handed one.
 *
 * What this does and does not guarantee. A symlink that is already in the destination when the copy
 * reaches it is removed as a link, never written through, and removing it destroys nothing of the
 * user's - `rmSync` unlinks the link and leaves its target alone. A symlink created in the gap
 * between that removal and the write is refused rather than followed, because both writes below are
 * exclusive-create primitives that fail with EEXIST.
 *
 * What is *not* covered, here and in {@link removeManagedRootEntry}, is a directory swapped for a
 * symlink between the {@link isRealDirectory} check and the step that acts on it. Every path-based
 * call in this module resolves links, so proving a component is a directory and then using it by
 * path is inherently two operations; closing that needs `openat`/`O_NOFOLLOW` and the `*at` family,
 * which Node exposes no synchronous equivalent of. The one place it could be closed with a handle -
 * setting a directory's mode after its contents are written - is, in {@link applyMode}. The rest is
 * a race against a writer who already has write access to the platform's own config directory, and
 * it is deliberately left open - see CHANGELOG. The native config files that `config-merger.ts`
 * writes into the destination follow the same rule, and carry the same residual.
 */
function copyIntoTarget(sourcePath: string, targetPath: string): void {
  const sourceStats = statsOf(sourcePath);
  if (sourceStats?.isDirectory()) {
    const created = !isRealDirectory(targetPath);
    if (created) {
      removePath(targetPath);
      createDirectoryExclusively(targetPath);
    }
    for (const entry of readDirectoryEntries(sourcePath)) {
      copyIntoTarget(join(sourcePath, entry), join(targetPath, entry));
    }
    // Mode after contents, the order `cpSync` uses: a read-only source directory must not lock us
    // out of filling the copy of it first.
    if (created) applyMode(targetPath, sourceStats.mode);
    return;
  }

  removeForReplacement(targetPath);
  copyLeaf(sourcePath, targetPath);
}

/**
 * Clear a path so a generated non-directory can take it - never recursively.
 *
 * A generated set that turns a name from a directory into a file used to bring `rmSync -r` down on
 * whatever the destination had under that name, which is the same shape as the `$HOME` deletion this
 * release exists to fix. Worse, the sweep runs first and deliberately keeps descendants no previous
 * install recorded, so the copy destroyed precisely the files the sweep had just saved. An empty
 * directory is removed and the file takes its place; one with anything in it stops the install and
 * says which path and why.
 */
function removeForReplacement(targetPath: string): void {
  const stats = statsOf(targetPath);
  if (!stats) return;
  if (!stats.isDirectory()) {
    unlinkManagedEntry(targetPath);
    return;
  }
  if (removeEmptyDirectory(targetPath)) return;
  throw new InstallError(
    `Cannot install the generated file at ${targetPath}: a directory is already there and is not empty. Move or remove it, then run the install again.`,
  );
}

/**
 * Copy to a path nothing occupies yet, reporting false when something already does.
 *
 * A backup that overwrites is not a backup, and replacing would destroy exactly the copy worth
 * keeping - the older one, holding the state furthest from whatever the installs have been doing.
 * The caller moves to another name instead.
 *
 * The claim on the name *is* the create, not a check before one. An `lstat` first and a copy after
 * leaves two runs able to agree the name is free: the loser's `copyIntoTarget` would then remove the
 * winner's file backup, or descend into and merge with the winner's directory backup. `mkdir` and
 * `copyFile` with `COPYFILE_EXCL` both fail with EEXIST instead, having touched nothing, so the
 * loser simply moves on to the next name.
 */
export function copyToNewPath(sourcePath: string, targetPath: string): boolean {
  const sourceStats = statsOf(sourcePath);
  if (sourceStats?.isDirectory()) {
    if (!reserveDirectory(targetPath)) return false;
    for (const entry of readDirectoryEntries(sourcePath)) {
      copyIntoTarget(join(sourcePath, entry), join(targetPath, entry));
    }
    // After the contents, as everywhere else here, and through a handle rather than the path.
    applyMode(targetPath, sourceStats.mode);
    return true;
  }

  if (sourceStats?.isFile()) return copyFileToNewPath(sourcePath, targetPath);

  // A symlink, or something `cpSync` refuses anyway. No exclusive create reproduces these, so the
  // claim is `errorOnExist`: a run that loses the name is told so and moves to the next one, rather
  // than aborting the install over a backup path another run got to first.
  try {
    cpSync(sourcePath, targetPath, { recursive: true, force: false, errorOnExist: true });
    return true;
  } catch (error) {
    if (isErrnoIn(error, EXISTS_CODES)) return false;
    throw new InstallError(`Failed to copy ${sourcePath} -> ${targetPath}`, error);
  }
}

/**
 * Reserve a backup directory, owner-only until its contents are in.
 *
 * The source mode can only be applied once the children are copied, so creating at the umask default
 * would leave a `0700` directory's children readable by every local user for the length of the copy -
 * and indefinitely if the copy failed partway. `0700` first is the conservative end of that window.
 */
function reserveDirectory(dirPath: string): boolean {
  try {
    mkdirSync(dirPath, 0o700);
    return true;
  } catch (error) {
    if (isErrnoIn(error, EXISTS_CODES)) return false;
    throw new InstallError(`Failed to create directory: ${dirPath}`, error);
  }
}

function copyFileToNewPath(sourcePath: string, targetPath: string): boolean {
  try {
    copyFileSync(sourcePath, targetPath, constants.COPYFILE_EXCL);
    return true;
  } catch (error) {
    if (isErrnoIn(error, EXISTS_CODES)) return false;
    throw new InstallError(`Failed to copy ${sourcePath} -> ${targetPath}`, error);
  }
}

/** Replace whatever is at `targetPath` with `sourcePath` outright - never merging, never following a link. */
function replaceWithSource(sourcePath: string, targetPath: string): void {
  removePath(targetPath);
  copyIntoTarget(sourcePath, targetPath);
}

/**
 * `mkdirSync` without `recursive`, so it fails with EEXIST instead of accepting whatever is already
 * there. The path was removed a moment earlier, so EEXIST means something arrived in between, and
 * that something can be a symlink pointing anywhere: stop rather than write into it.
 */
function createDirectoryExclusively(dirPath: string): void {
  try {
    mkdirSync(dirPath);
  } catch (error) {
    throw new InstallError(`Failed to create directory: ${dirPath}`, error);
  }
}

/**
 * Write one non-directory source entry to a path that must not exist.
 *
 * `COPYFILE_EXCL` fails with EEXIST rather than opening whatever is at the destination, which is
 * what stops a symlink created since the removal from being followed out of the platform root -
 * `cpSync` has no such mode. It is kept for the entry types the exclusive primitive does not cover
 * (a symlink, and the FIFOs and sockets it refuses outright, as it always has): copying a symlink
 * writes a symlink, so it cannot write through one either.
 */
function copyLeaf(sourcePath: string, targetPath: string): void {
  if (!statsOf(sourcePath)?.isFile()) {
    copyPath(sourcePath, targetPath);
    return;
  }

  try {
    copyFileSync(sourcePath, targetPath, constants.COPYFILE_EXCL);
  } catch (error) {
    throw new InstallError(`Failed to copy ${sourcePath} -> ${targetPath}`, error);
  }
}

/**
 * Set a directory's mode through a handle that cannot be a symlink, rather than by path.
 *
 * `chmodSync` follows a link, and this runs after the children have been written - a window in which
 * the directory could have been swapped for one pointing anywhere, making the mode change land on a
 * file outside the destination entirely. `O_NOFOLLOW | O_DIRECTORY` refuses to open a link at all,
 * so the handle is either this directory or nothing. Windows has neither flag and no unprivileged
 * symlink creation, so it keeps the path-based call.
 */
function applyMode(path: string, mode: number): void {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const directoryOnly = constants.O_DIRECTORY ?? 0;
  try {
    if (!noFollow || !directoryOnly) {
      chmodSync(path, mode & 0o7777);
      return;
    }

    const handle = openSync(path, constants.O_RDONLY | directoryOnly | noFollow);
    try {
      fchmodSync(handle, mode & 0o7777);
    } finally {
      closeSync(handle);
    }
  } catch (error) {
    throw new InstallError(`Failed to set permissions on: ${path}`, error);
  }
}

/**
 * Create or accept one directory the install owns, below the platform's config root.
 *
 * `ensureDir` is `mkdir -p`, and `mkdir -p` accepts a symlink already sitting at the path - so a
 * link planted at `<root>/agents` had every later write, removal and directory creation land beyond
 * it, outside the destination. This refuses that outright rather than replacing it, matching the
 * verdict `validateManagedDestinations` already gives the same paths in preflight; preflight only
 * walks paths that are in the current managed set, which is the gap a category that generates no
 * files, or a link planted after preflight, slipped through.
 *
 * Creation is exclusive, so losing a race to a concurrent writer fails rather than adopting whatever
 * they made. This is for a single component whose parent is already established - the platform
 * config root itself is created with {@link ensureDir}, since everything at or above it is the
 * user's own directory layout rather than something the install manages.
 */
function ensureManagedDirectory(dirPath: string): void {
  const stats = statsOf(dirPath);
  if (!stats) {
    createDirectoryExclusively(dirPath);
    return;
  }
  // `lstat`, so a symlink is never a directory here however it points.
  if (stats.isDirectory()) return;
  if (stats.isSymbolicLink()) {
    throw new InstallError(`Refusing to install through a symbolic link: ${dirPath}`);
  }
  throw new InstallError(`Cannot install into ${dirPath}: it exists and is not a directory`);
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
  ensureManagedDirectory(targetDir);
  if (rule.alternateRelativeDirs && rule.alternateRelativeDirs.length > 0) {
    copyNestedNamedDirectory(sourceDir, targetDir, rule, logger);
    return;
  }

  const entries = readDirectoryEntries(sourceDir);
  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, entry);
    replaceWithSource(sourcePath, targetPath);
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
    ensureManagedDirectory(targetNestedDir);
    for (const entry of readDirectoryEntries(sourceNestedDir)) {
      const sourcePath = join(sourceNestedDir, entry);
      const targetPath = join(targetNestedDir, entry);
      replaceWithSource(sourcePath, targetPath);
      logger?.dim(`  ${relativeDir}/${entry}`);
    }
  }
}
