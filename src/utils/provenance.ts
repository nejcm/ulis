import type { Dirent } from "node:fs";
import { readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { ULIS_PROVENANCE_FILENAME } from "../config.js";
import { InstallError } from "../install/errors.js";
import { PLATFORMS, type Platform } from "../platforms.js";
import { ensureDir, fileExists, readFile } from "./fs.js";
import { redactUserinfo } from "./redact.js";

/**
 * Which remote sources contributed to each platform subtree of a `generated/` output, keyed by
 * platform rather than one flat list. `runBuild` can target a subset of platforms (`--target
 * codex`), so a narrow local rebuild must only touch the entries for the platforms it actually
 * regenerated - clearing the whole record would leave a remote payload sitting in an untouched
 * platform dir with no record naming it, which is exactly the gate this file exists to keep armed.
 */
export interface ProvenanceRecord {
  readonly version: 1;
  readonly remoteSources: Readonly<Partial<Record<Platform, readonly string[]>>>;
}

function provenancePath(outputDir: string): string {
  return join(outputDir, ULIS_PROVENANCE_FILENAME);
}

/**
 * True only for a plain object keyed by known platform ids, each mapped to a string array. Rejects
 * an array (`Object.values([]).every(...)` is vacuously true, so an array would otherwise pass as
 * an empty map - the exact fail-open a version-1 record must not have) and rejects an unknown or
 * mis-cased key on purpose: a record naming a platform this binary does not recognise must make the
 * whole record unreadable, not have that one entry silently ignored by the platform-keyed lookup in
 * {@link readRecordedRemoteSources}.
 */
function isRemoteSourcesMap(value: unknown): value is Partial<Record<Platform, readonly string[]>> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const platformNames = new Set<string>(PLATFORMS);
  return Object.entries(value as Record<string, unknown>).every(
    ([key, urls]) => platformNames.has(key) && Array.isArray(urls) && urls.every((url) => typeof url === "string"),
  );
}

function parseRecord(contents: string): ProvenanceRecord | undefined {
  const parsed: unknown = JSON.parse(contents);
  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as ProvenanceRecord).version === 1 &&
    isRemoteSourcesMap((parsed as ProvenanceRecord).remoteSources)
  ) {
    return parsed as ProvenanceRecord;
  }
  return undefined;
}

/**
 * Platform subdirectories that actually exist under `outputDir` right now, for the unreadable-record
 * carve-out in {@link writeProvenanceRecord}. `entry.isDirectory()` is false for a `Dirent`
 * describing a symlink, but the installer's `copyPath`/`cpSync` follows one - so a symlinked
 * platform dir is resolved through `statSync` rather than trusted on the `Dirent` type alone, or a
 * narrow rebuild could see a symlinked platform as absent and wrongly call a build "full".
 *
 * Filtered to known platform names first, and only then checked on disk: a stray directory this
 * binary does not recognise as a platform must not wedge the heal-by-full-rebuild path by counting
 * as "always uncovered". That leaves one gap - a directory named for a platform a *future* ULIS
 * knows about but this one does not (`generated/futuretool`) stays invisible here, so a full
 * rebuild could still discard a record naming it. `isRemoteSourcesMap`'s key validation covers the
 * realistic half of that: a *record* naming an unknown platform already fails to parse and refuses
 * outright, rather than being silently discarded by this carve-out.
 */
function existingPlatformDirs(outputDir: string): readonly Platform[] {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(outputDir, { withFileTypes: true, encoding: "utf-8" });
  } catch {
    return [];
  }
  const platformNames = new Set<string>(PLATFORMS);
  return entries
    .filter((entry) => platformNames.has(entry.name))
    .filter(
      (entry) =>
        entry.isDirectory() || statSync(join(outputDir, entry.name), { throwIfNoEntry: false })?.isDirectory() === true,
    )
    .map((entry) => entry.name as Platform);
}

type LenientRead =
  | { readonly status: "absent" }
  | { readonly status: "ok"; readonly record: ProvenanceRecord }
  | { readonly status: "unreadable" };

/**
 * Read the record for {@link writeProvenanceRecord}'s own merge step, distinguishing "no file" from
 * "file present but unparseable" - the two need different handling there. Never throws.
 */
function readRecordLeniently(outputDir: string): LenientRead {
  const path = provenancePath(outputDir);
  if (!fileExists(path)) return { status: "absent" };
  try {
    const record = parseRecord(readFile(path));
    return record ? { status: "ok", record } : { status: "unreadable" };
  } catch {
    return { status: "unreadable" };
  }
}

/**
 * Read the record for the install-time gate. Strict on purpose: this is the one read whose answer
 * decides whether an unreviewed tree gets installed, and an unreadable record is exactly the case
 * where the platforms it names cannot be ruled out - failing open here is the same bypass class
 * this file exists to close. The remedy is a *full* rebuild (see {@link writeProvenanceRecord}),
 * so refusing outright costs nothing but an extra rebuild.
 */
function readRecordStrictly(outputDir: string): ProvenanceRecord | undefined {
  const path = provenancePath(outputDir);
  if (!fileExists(path)) return undefined;
  let record: ProvenanceRecord | undefined;
  try {
    record = parseRecord(readFile(path));
  } catch (error) {
    throw new InstallError(
      `Could not parse the provenance record at ${path}. It may be truncated by an interrupted write. ` +
        "A full rebuild (no --target) recreates it, or delete the file if you accept losing its remote-source history.",
      error,
    );
  }
  if (!record) {
    throw new InstallError(
      `The provenance record at ${path} is not a version this ULIS understands. ` +
        "A full rebuild (no --target) recreates it, or delete the file if you accept losing its remote-source history.",
    );
  }
  return record;
}

/**
 * Write `contents` to `path` atomically: a same-directory temp file plus `rename`, which POSIX
 * guarantees is atomic - no reader ever observes a half-written file. Without this, a build killed
 * mid-write (`kill -9`, disk full) could leave `readRecordStrictly` looking at truncated JSON for
 * entries the write never actually touched. This is not a durability guarantee across a hard power
 * loss (no `fsync`): only that a reader sees either the old complete file or the new one, never a
 * torn one. The temp file is removed on any failure so a crash never leaves it behind for a user to
 * find (and possibly commit) next to the real record.
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

/**
 * Update `outputDir`'s provenance record for exactly the platforms this build just (re)generated
 * (`targets`). Every other platform's entry, written by an earlier build that covered a different
 * target set, is left as-is. An empty `remoteUrls` clears `targets`' own entries rather than
 * leaving a stale one behind; the file itself is removed once no platform has an entry left. URLs
 * are redacted before writing - the record lands in a source tree a user may commit.
 *
 * If the existing record is present but unreadable (a future version, corruption, a hand-edit), a
 * *narrow* rebuild leaves it exactly as it is rather than guess at what it named: merging on top of
 * a lenient "treat as empty" read would silently drop whatever it recorded for the platforms this
 * build did not touch, and `Object.keys(next).length === 0` could even delete the file outright -
 * turning "refuse" into "no record" for output this build never looked at. Only when `targets`
 * covers every platform directory actually present under `outputDir` is discarding it safe: a
 * *full* rebuild regenerates everything the record could have named, so nothing it might have said
 * survives unregenerated, and starting fresh from this build's own targets/remoteUrls is correct.
 */
export function writeProvenanceRecord(
  outputDir: string,
  targets: readonly Platform[],
  remoteUrls: readonly string[],
): void {
  const existing = readRecordLeniently(outputDir);
  if (existing.status === "unreadable") {
    const targetSet = new Set(targets);
    const fullyCovered = existingPlatformDirs(outputDir).every((platform) => targetSet.has(platform));
    if (!fullyCovered) return;
  }

  const redacted = [...new Set(remoteUrls.map(redactUserinfo))];
  const next: Partial<Record<Platform, readonly string[]>> = {
    ...(existing.status === "ok" ? existing.record.remoteSources : {}),
  };
  for (const target of targets) {
    if (redacted.length > 0) next[target] = redacted;
    else delete next[target];
  }

  const path = provenancePath(outputDir);
  if (Object.keys(next).length === 0) {
    rmSync(path, { force: true });
    return;
  }
  // Fixed key order (`PLATFORMS`, not insertion order): identical final inputs must produce
  // byte-identical output regardless of which order platforms were built in across separate runs -
  // this file lands in `generated/`, and map-iteration order in emitted output is exactly what
  // AGENTS.md forbids.
  const orderedRemoteSources = Object.fromEntries(
    PLATFORMS.filter((platform) => next[platform]).map((platform) => [platform, next[platform]!]),
  ) as Partial<Record<Platform, readonly string[]>>;
  const record: ProvenanceRecord = { version: 1, remoteSources: orderedRemoteSources };
  writeAtomic(path, `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * Redacted remote-source URLs recorded against any of `platforms`, deduplicated - or `[]` when
 * none of them have one. Narrowed to `platforms` so a record naming a platform this run does not
 * plan to touch cannot block it. Throws when the record exists but cannot be trusted; see
 * {@link readRecordStrictly}.
 */
export function readRecordedRemoteSources(outputDir: string, platforms: readonly Platform[]): readonly string[] {
  const record = readRecordStrictly(outputDir);
  if (!record) return [];
  const urls = new Set<string>();
  for (const platform of platforms) {
    for (const url of record.remoteSources[platform] ?? []) urls.add(url);
  }
  return [...urls];
}
