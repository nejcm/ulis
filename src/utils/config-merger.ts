import {
  closeSync,
  cpSync,
  existsSync,
  fchmodSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { patch as patchToml, TomlDocument, TomlFormat } from "@decimalturn/toml-patch";
import * as smolToml from "smol-toml";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  isSamePath,
  PLATFORM_DIRS,
  platformConfigDir,
  resolvePlatformDirSegment,
  type Platform,
} from "../platforms.js";
import { ensureDir, fileExists, readFile, writeFile } from "./fs.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeConfigValues(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = mergeConfigValues(result[key], value);
  }
  return result;
}

function patchTomlOverlay(existingContent: string, generatedContent: string, merged: unknown): string {
  const format = TomlFormat.autoDetectFormat(existingContent);
  const compatibleContent = removeConflictingTomlRepresentations(existingContent, generatedContent);
  const arraySeededContent = seedMissingTomlTables(compatibleContent, generatedContent, "array");
  let retryContent = arraySeededContent;
  let retryFilter: ((header: TomlTableHeader) => boolean) | undefined;
  try {
    const patched = patchToml(arraySeededContent, merged, format);
    const patchedConfig = smolToml.parse(patched);
    if (isDeepStrictEqual(patchedConfig, merged)) return patched;
    retryContent = patched;
    retryFilter = ({ path }) => !isDeepStrictEqual(getConfigPath(patchedConfig, path), getConfigPath(merged, path));
  } catch {
    // Missing nested tables are seeded below before retrying.
  }

  const seededContent = seedMissingTomlTables(retryContent, generatedContent, "table", retryFilter);
  const patched = patchToml(seededContent, merged, format);
  if (!isDeepStrictEqual(smolToml.parse(patched), merged)) {
    throw new Error("TOML patch did not produce the requested merged config");
  }
  return patched;
}

function removeConflictingTomlRepresentations(existingContent: string, generatedContent: string): string {
  const desiredKinds = new Map(
    tomlTableHeaders(generatedContent).map(({ kind, path }) => [JSON.stringify(path), kind]),
  );
  if (desiredKinds.size === 0) return existingContent;

  const removals: Array<{ start: number; end: number }> = [];
  const lineOffsets = tomlLineOffsets(existingContent);
  const addRemoval = (loc: { start: { line: number; column: number }; end: { line: number; column: number } }) => {
    const start = lineOffsets[loc.start.line - 1]! + loc.start.column;
    let end = lineOffsets[loc.end.line - 1]! + loc.end.column;
    if (existingContent.startsWith("\r\n", end)) end += 2;
    else if (existingContent[end] === "\n") end += 1;
    removals.push({ start, end });
  };

  for (const block of new TomlDocument(existingContent).cst) {
    if (block.type === "Table" || block.type === "TableArray") {
      const tablePath = block.key.item.value;
      const existingKind = block.type === "TableArray" ? "array" : "table";
      const desiredKind = desiredKinds.get(JSON.stringify(tablePath));
      if (desiredKind !== undefined && desiredKind !== existingKind) {
        addRemoval(block.loc);
        continue;
      }

      for (const item of block.items) {
        if (item.type !== "KeyValue") continue;
        if (desiredKinds.has(JSON.stringify([...tablePath, ...item.key.value]))) addRemoval(item.loc);
      }
    } else if (block.type === "KeyValue" && desiredKinds.has(JSON.stringify(block.key.value))) {
      addRemoval(block.loc);
    }
  }

  return removals
    .sort((left, right) => right.start - left.start)
    .reduce((content, { start, end }) => content.slice(0, start) + content.slice(end), existingContent);
}

function tomlLineOffsets(content: string): number[] {
  const offsets = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") offsets.push(index + 1);
  }
  return offsets;
}

function seedMissingTomlTables(
  existingContent: string,
  generatedContent: string,
  onlyKind?: "array" | "table",
  shouldSeed?: (header: TomlTableHeader) => boolean,
): string {
  const existingHeaders = new Set(tomlTableHeaders(existingContent).map(({ key }) => key));
  const missingHeaders = tomlTableHeaders(generatedContent)
    .filter(({ kind }) => onlyKind === undefined || kind === onlyKind)
    // toml-patch cannot patch a newly seeded nested array-of-tables (for
    // example [[skills.config]]). Without the seed it emits an equivalent
    // inline array and still preserves the surrounding document.
    .filter(({ kind, path }) => kind !== "array" || path.length === 1)
    .filter((header) => shouldSeed?.(header) ?? true)
    .filter(({ key }) => !existingHeaders.has(key))
    .map(({ line }) => line);

  if (missingHeaders.length === 0) return existingContent;
  const newline = existingContent.includes("\r\n") ? "\r\n" : "\n";
  const separator = existingContent.endsWith(newline) ? newline : `${newline}${newline}`;
  return `${existingContent}${separator}${missingHeaders.join(`${newline}${newline}`)}${newline}`;
}

interface TomlTableHeader {
  readonly key: string;
  readonly kind: "array" | "table";
  readonly line: string;
  readonly path: readonly string[];
}

function tomlTableHeaders(content: string): TomlTableHeader[] {
  const lines = content.split(/\r?\n/);
  return new TomlDocument(content).cst.flatMap((block) => {
    if (block.type !== "Table" && block.type !== "TableArray") return [];
    const kind = block.type === "TableArray" ? "array" : "table";
    const path = block.key.item.value;
    const line = lines[block.loc.start.line - 1]!;
    return [{ key: `${kind}:${JSON.stringify(path)}`, kind, line, path }];
  });
}

const MERGE_EXTS = new Set([".json", ".toml", ".yaml", ".yml"]);

function isMergeable(filePath: string): boolean {
  return MERGE_EXTS.has(extname(filePath).toLowerCase());
}

export function readMergeableConfig(filePath: string): unknown {
  const ext = extname(filePath).toLowerCase();
  if (!MERGE_EXTS.has(ext)) throw new Error(`Unsupported config extension: ${ext}`);
  const content = readFile(filePath);
  if (ext === ".json") return JSON.parse(content) as unknown;
  if (ext === ".toml") return smolToml.parse(content);
  return parseYaml(content) as unknown;
}

export function writeMergeableConfig(filePath: string, value: unknown): void {
  writeFile(filePath, serializeMergeableConfig(filePath, value));
}

/** Split out so a destination write can serialise here and write through {@link writeDestinationFile}. */
function serializeMergeableConfig(filePath: string, value: unknown): string {
  const ext = extname(filePath).toLowerCase();
  if (!MERGE_EXTS.has(ext)) throw new Error(`Unsupported config extension: ${ext}`);
  if (ext === ".json") return JSON.stringify(value, null, 2);
  if (ext === ".toml") return smolToml.stringify(value as Record<string, smolToml.TomlPrimitive>);
  return stringifyYaml(value);
}

/**
 * Write a native config file into the destination, never through a symbolic link.
 *
 * These are the platform's real config files - the MCP servers and hooks a host agent acts on - and
 * `writeFile` follows a link at the destination, so one planted at `opencode.json` or `.claude.json`
 * made the install write wherever it pointed, with content the planter already influences since the
 * existing file is what gets preserved and merged into the result. Remove-then-exclusive-create is
 * the same pair `src/install/fs.ts` uses: the link is unlinked as a link, and the create fails
 * rather than adopting anything that appears in between.
 */
function writeDestinationFile(filePath: string, content: string | Buffer, sourceMode?: number): void {
  refuseSymlinkAt(filePath);
  writeFileExclusively(filePath, content, sourceMode);
}

/**
 * {@link writeDestinationFile} for the generated tree, which ULIS owns outright and rewrites on every
 * build: a symlink there is replaced rather than refused, since nobody put it there deliberately.
 */
function writeGeneratedFile(filePath: string, content: string | Buffer): void {
  writeFileExclusively(filePath, content);
}

function writeFileExclusively(filePath: string, content: string | Buffer, sourceMode?: number): void {
  ensureDir(dirname(filePath));
  // The mode to land on: the one the file being replaced already had, or - when there is nothing to
  // replace - the mode of the file being copied in. `rmSync` takes the old mode away with the inode
  // and a fresh create lands at the process umask, so a `0600` config holding MCP environment values
  // came back `0644` and readable by every local user. A verbatim copy of a `0600` generated file
  // onto a path that does not exist yet has the same problem from the other side.
  const mode = existingFileMode(filePath) ?? sourceMode;
  rmSync(filePath, { force: true });
  // Created, written and chmodded through one descriptor. `wx` is the exclusive create; `fchmodSync`
  // needs no path, and resolving the path a second time to `chmod` it would leave a window for a
  // concurrent writer to swap in a symlink and have us change permissions on a file outside the
  // destination. `applyMode` in `src/install/fs.ts` avoids the same window the same way.
  const handle = openSync(filePath, "wx", mode ?? 0o666);
  try {
    writeFileSync(handle, content);
    // The mode passed to `open` is masked by the umask; this restores it exactly.
    if (mode !== undefined) fchmodSync(handle, mode);
  } finally {
    closeSync(handle);
  }
}

/**
 * {@link writeDestinationFile} for a verbatim copy. Reads the bytes and goes through the one writer
 * rather than `copyFileSync`, which needs its own exclusive-create flag and its own mode handling -
 * two implementations of the same rule is what keeps going wrong here. The source's mode is carried
 * across explicitly, since `copyFileSync` would have done that and a plain write would not.
 */
function copyDestinationFile(sourcePath: string, filePath: string): void {
  writeDestinationFile(filePath, readFileSync(sourcePath), existingFileMode(sourcePath));
}

function isSymbolicLink(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Mode of an existing regular file. A symlink is refused before this, a directory fails at the write. */
function existingFileMode(filePath: string): number | undefined {
  try {
    const stats = lstatSync(filePath);
    return stats.isFile() ? stats.mode & 0o7777 : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Refuse a symbolic link where a native config file belongs.
 *
 * Safety does not rest on this check: both writers above unlink and create exclusively, so neither
 * can follow a link whatever this reports. It exists to fail loudly and name the path, because a
 * link here is about as likely to be a dotfile manager's as an attacker's, and quietly replacing a
 * deliberate one is its own kind of data loss. That is also why an `lstat` which cannot answer is
 * simply left alone - the write below fails on the same error, so nothing is decided by the silence.
 */
function refuseSymlinkAt(filePath: string): void {
  let stats;
  try {
    stats = lstatSync(filePath);
  } catch {
    return;
  }
  if (!stats.isSymbolicLink()) return;
  throw new UnsafeNativeConfigPathError(filePath);
}

function mergeOrCopyFile(srcFile: string, destFile: string): void {
  // A symlink at the destination is never a merge base. `raw/` layers merge into the generated tree
  // one after another, so the first layer copying a link in was enough for the second to read
  // through it and write through it - a remote source having the build modify a file outside the
  // generated tree, after the trust prompt had already been answered. Replaced, not followed.
  if (isSymbolicLink(destFile) || !fileExists(destFile) || !isMergeable(destFile)) {
    copyRawFile(srcFile, destFile);
    return;
  }

  try {
    const generated = readMergeableConfig(destFile);
    const raw = readMergeableConfig(srcFile);
    writeGeneratedFile(destFile, serializeMergeableConfig(destFile, mergeConfigValues(generated, raw)));
  } catch (err) {
    console.warn(`[config-merger] merge failed for ${destFile}: ${err}. Copying raw file as-is.`);
    copyRawFile(srcFile, destFile);
  }
}

/**
 * Copy one `raw/` file into the generated tree. The removal is non-recursive, so a symlink an
 * earlier layer left there is unlinked as a link rather than written through, and a directory stops
 * it. The source is copied as it is - a link in `raw/` stays a link, which is the author's own tree.
 */
function copyRawFile(srcFile: string, destFile: string): void {
  ensureDir(dirname(destFile));
  rmSync(destFile, { force: true });
  cpSync(srcFile, destFile);
}

export function mergeOrCopyDir(
  srcDir: string,
  destDir: string,
  shouldCopy: (relativePath: string) => boolean = () => true,
): void {
  if (!fileExists(srcDir)) return;

  const visit = (currentSrcDir: string, currentDestDir: string, prefix: string): void => {
    ensureDir(currentDestDir);
    for (const entry of readdirSync(currentSrcDir)) {
      const relativePath = join(prefix, entry);
      if (!shouldCopy(relativePath)) continue;

      const srcPath = join(currentSrcDir, entry);
      const destPath = join(currentDestDir, entry);
      if (statSync(srcPath).isDirectory()) {
        visit(srcPath, destPath, relativePath);
      } else {
        mergeOrCopyFile(srcPath, destPath);
      }
    }
  };

  visit(srcDir, destDir, "");
}

export type ConfigPath = readonly string[];

interface PreservedNativeConfigLogger {
  success(message: string): void;
}

export interface PreservedNativeConfigContext {
  readonly outputDir: string;
  readonly destBase: string;
  readonly userHome: string;
}

type Ownership = "file" | "paths";
type OverlayMode = "json" | "toml";

interface PreservedNativeConfigSpec {
  readonly platform: Platform;
  readonly label: string;
  /**
   * Every basename the destination file can have. Declared rather than derived from `targetPath`,
   * which needs a context and can vary by install mode. Required, so a new platform cannot be added
   * without saying which files it reads natively - {@link NATIVE_CONFIG_FILENAMES} is what the
   * remote-source trust preview checks a `raw/` fragment against, and a missing entry there means a
   * hook or an MCP server installs unannounced.
   */
  readonly names: readonly string[];
  readonly generatedPath: (context: PreservedNativeConfigContext) => string;
  readonly targetPath: (context: PreservedNativeConfigContext) => string;
  readonly preservedPaths: readonly ConfigPath[];
  /** Preserve the complete existing object as the base, taking precedence over `ownership`. */
  readonly overlay?: OverlayMode | ((context: PreservedNativeConfigContext) => OverlayMode | undefined);
  /**
   * Ownership model for the target file. May be a literal or context-derived:
   * - "file" (default): ULIS owns the whole file. `preservedPaths` are
   *    exceptions PICKED from the existing file and merged on top of the
   *    generated content (so user-owned keys like `hooks` survive).
   * - "paths": ULIS owns ONLY `preservedPaths`. Everything else in the existing
   *    file is preserved. Used for host-owned files such as `~/.claude.json`
   *    where ULIS contributes only `mcpServers` but Claude Code owns the rest
   *    (projects, plugins, theme, history, ...).
   */
  readonly ownership?: Ownership | ((context: PreservedNativeConfigContext) => Ownership);
}

export interface PreservedNativeConfigEntry {
  readonly label: string;
  readonly generatedPath: string;
  readonly targetPath: string;
  readonly preservedPaths: readonly ConfigPath[];
  readonly ownership?: Ownership;
  readonly overlay?: OverlayMode;
}

export interface CapturedPreservedNativeConfig extends PreservedNativeConfigEntry {
  readonly preservedConfig: unknown | undefined;
  readonly originalContent?: string;
}

/**
 * A native config path the install refuses to write. Named so the install path can surface the
 * message as-is: it tells the user which file is a symlink and what to do about it, and a generic
 * "failed to write preserved native config" wrapper would bury exactly the part that is actionable.
 */
export class UnsafeNativeConfigPathError extends Error {
  constructor(readonly targetPath: string) {
    super(
      `Refusing to write through a symbolic link: ${targetPath}. Remove it, or point it somewhere ULIS is installing to.`,
    );
    this.name = "UnsafeNativeConfigPathError";
  }
}

export class PreservedNativeConfigParseError extends Error {
  constructor(
    readonly targetPath: string,
    cause: unknown,
  ) {
    super(`Failed to parse existing native config at ${targetPath}`, { cause });
    this.name = "PreservedNativeConfigParseError";
  }
}

export const PRESERVED_NATIVE_CONFIGS = [
  {
    platform: "opencode",
    label: "opencode.json",
    names: ["opencode.json"],
    generatedPath: (context) => join(context.outputDir, "opencode", "opencode.json"),
    targetPath: (context) => join(platformConfigDir("opencode", context.destBase, context.userHome), "opencode.json"),
    preservedPaths: [["mcp"]],
  },
  {
    platform: "claude",
    label: "settings.json",
    names: ["settings.json"],
    generatedPath: (context) => join(context.outputDir, "claude", "settings.json"),
    targetPath: (context) => join(platformConfigDir("claude", context.destBase, context.userHome), "settings.json"),
    preservedPaths: [
      ["hooks"],
      ["statusLine"],
      ["enabledPlugins"],
      ["extraKnownMarketplaces"],
      ["autoUpdatesChannel"],
      ["agentPushNotifEnabled"],
      ["theme"],
    ],
    overlay: "json",
  },
  {
    platform: "claude",
    // Machine-local overrides Claude Code owns. ULIS only contributes what a raw
    // fragment provides, so the existing file is the base and generated values
    // overlay on top; with no generated file the user's file is left untouched.
    label: "settings.local.json",
    names: ["settings.local.json"],
    generatedPath: (context) => join(context.outputDir, "claude", "settings.local.json"),
    targetPath: (context) =>
      join(platformConfigDir("claude", context.destBase, context.userHome), "settings.local.json"),
    preservedPaths: [[]],
    overlay: "json",
  },
  {
    platform: "claude",
    label: ".claude.json / .mcp.json",
    names: [".claude.json", ".mcp.json"],
    generatedPath: (context) => join(context.outputDir, "claude", ".claude.json"),
    // Claude Code reads MCP servers from two different files depending on scope:
    // - Global install (~): user-scope `~/.claude.json` (huge file Claude Code owns —
    //   `projects`, `enabledPlugins`, history, theme, telemetry, ... — ULIS only
    //   contributes `mcpServers`).
    // - Project install (<cwd>): project-scope `<cwd>/.mcp.json` (committed, just `{ mcpServers }`).
    // The generated `.claude.json` content (`{ mcpServers: {...} }`) fits both formats.
    // Merge behavior differs by mode:
    // - Global (~/.claude.json): overlay generated MCP values onto the complete
    //   existing file, preserving all absent keys and unmanaged MCP servers.
    // - Project (<cwd>/.mcp.json): "file" — the file is just `{ mcpServers }`,
    //   retaining the existing selective merge behavior.
    targetPath: (context) =>
      isSamePath(context.destBase, context.userHome)
        ? join(context.destBase, ".claude.json")
        : join(context.destBase, ".mcp.json"),
    preservedPaths: [["mcpServers"]],
    ownership: (context) => (isSamePath(context.destBase, context.userHome) ? "paths" : "file"),
    overlay: (context) => (isSamePath(context.destBase, context.userHome) ? "json" : undefined),
  },
  {
    platform: "codex",
    label: "config.toml",
    names: ["config.toml"],
    generatedPath: (context) => join(context.outputDir, "codex", "config.toml"),
    targetPath: (context) => join(platformConfigDir("codex", context.destBase, context.userHome), "config.toml"),
    preservedPaths: [["projects"], ["hooks"], ["mcp_servers"], ["tui"], ["notice"], ["features"]],
    overlay: "toml",
  },
  {
    platform: "cursor",
    label: "mcp.json",
    names: ["mcp.json"],
    generatedPath: (context) => join(context.outputDir, "cursor", "mcp.json"),
    targetPath: (context) => join(platformConfigDir("cursor", context.destBase, context.userHome), "mcp.json"),
    preservedPaths: [["mcpServers"]],
  },
  {
    platform: "forgecode",
    label: ".mcp.json",
    names: [".mcp.json"],
    generatedPath: (context) =>
      join(context.outputDir, "forgecode", resolvePlatformDirSegment(PLATFORM_DIRS.forgecode.project), ".mcp.json"),
    targetPath: (context) => join(platformConfigDir("forgecode", context.destBase, context.userHome), ".mcp.json"),
    preservedPaths: [["mcpServers"]],
  },
  {
    platform: "forgecode",
    label: ".forge.toml",
    names: [".forge.toml"],
    generatedPath: (context) => join(context.outputDir, "forgecode", ".forge.toml"),
    targetPath: (context) => join(platformConfigDir("forgecode", context.destBase, context.userHome), ".forge.toml"),
    preservedPaths: [[]],
  },
] as const satisfies readonly PreservedNativeConfigSpec[];

/**
 * Every basename a platform reads as its own native config. These files carry hooks, startup
 * commands and MCP server definitions, so a `raw/` fragment landing in one installs behaviour the
 * host agent later executes on its own — which is why the remote-source trust preview names them.
 * Derived from the specs above so adding a platform cannot silently reopen that hole.
 */
export const NATIVE_CONFIG_FILENAMES: ReadonlySet<string> = new Set(
  PRESERVED_NATIVE_CONFIGS.flatMap((spec) => spec.names),
);

export function nativeConfigFilenames(platform: Platform): ReadonlySet<string> {
  return new Set(PRESERVED_NATIVE_CONFIGS.filter((spec) => spec.platform === platform).flatMap((spec) => spec.names));
}

export function getPreservedNativeConfigEntries(
  platform: Platform,
  context: PreservedNativeConfigContext,
): readonly PreservedNativeConfigEntry[] {
  return PRESERVED_NATIVE_CONFIGS.filter((spec) => spec.platform === platform).map((spec) => {
    const rawOwnership = "ownership" in spec ? spec.ownership : undefined;
    const ownership: Ownership = typeof rawOwnership === "function" ? rawOwnership(context) : (rawOwnership ?? "file");
    const rawOverlay = "overlay" in spec ? spec.overlay : undefined;
    const overlay = typeof rawOverlay === "function" ? rawOverlay(context) : rawOverlay;
    return {
      label: spec.label,
      generatedPath: spec.generatedPath(context),
      targetPath: spec.targetPath(context),
      preservedPaths: spec.preservedPaths,
      ownership,
      ...(overlay ? { overlay } : {}),
    };
  });
}

export function capturePreservedNativeConfigs(
  platform: Platform,
  context: PreservedNativeConfigContext,
): readonly CapturedPreservedNativeConfig[] {
  return getPreservedNativeConfigEntries(platform, context).map((entry) => {
    const captured = capturePreservedConfig(entry);
    return { ...entry, ...captured };
  });
}

export function writePreservedNativeConfigs(
  entries: readonly CapturedPreservedNativeConfig[],
  logger?: PreservedNativeConfigLogger,
): void {
  for (const entry of entries) {
    writePreservedNativeConfig(entry, logger);
  }
}

function capturePreservedConfig(
  entry: PreservedNativeConfigEntry,
): Pick<CapturedPreservedNativeConfig, "preservedConfig" | "originalContent"> {
  if (!existsSync(entry.targetPath)) return { preservedConfig: undefined };

  try {
    const existing = readMergeableConfig(entry.targetPath);
    if (entry.overlay) {
      return {
        preservedConfig: existing,
        ...(entry.overlay === "toml" ? { originalContent: readFile(entry.targetPath) } : {}),
      };
    }

    const preserved =
      entry.ownership === "paths"
        ? omitConfigPaths(existing, entry.preservedPaths)
        : pickConfigPaths(existing, entry.preservedPaths);
    return {
      preservedConfig: Object.keys(preserved).length > 0 ? preserved : undefined,
    };
  } catch (error) {
    throw new PreservedNativeConfigParseError(entry.targetPath, error);
  }
}

export function pickConfigPaths(source: unknown, paths: readonly ConfigPath[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const path of paths) {
    if (path.length === 0) {
      if (isPlainObject(source)) Object.assign(result, source);
      continue;
    }
    const value = getConfigPath(source, path);
    if (value !== undefined) setConfigPath(result, path, value);
  }
  return result;
}

/**
 * Return a deep clone of `source` with the given paths removed. Used by the
 * `ownership: "paths"` preservation mode to capture "everything except the
 * paths ULIS owns" — the inverse of {@link pickConfigPaths}.
 */
export function omitConfigPaths(source: unknown, paths: readonly ConfigPath[]): Record<string, unknown> {
  if (!isPlainObject(source)) return {};
  // Empty path => caller wants to drop the entire object; honor it.
  if (paths.some((p) => p.length === 0)) return {};
  const result = structuredClone(source) as Record<string, unknown>;
  for (const path of paths) {
    deleteConfigPath(result, path);
  }
  return result;
}

function deleteConfigPath(target: Record<string, unknown>, path: readonly string[]): void {
  if (path.length === 0) return;
  let current: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    const next = current[path[i]!];
    if (!isPlainObject(next)) return;
    current = next;
  }
  delete current[path[path.length - 1]!];
}

function getConfigPath(source: unknown, path: readonly string[]): unknown {
  let current = source;
  for (const key of path) {
    if (!isPlainObject(current) || !(key in current)) return undefined;
    current = current[key];
  }
  return current;
}

function setConfigPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let current = target;
  for (const key of path.slice(0, -1)) {
    const next = current[key];
    if (isPlainObject(next)) {
      current = next;
    } else {
      const created: Record<string, unknown> = {};
      current[key] = created;
      current = created;
    }
  }
  current[path[path.length - 1]!] = value;
}

function writePreservedNativeConfig(entry: CapturedPreservedNativeConfig, logger?: PreservedNativeConfigLogger): void {
  try {
    // Once, for every branch below, rather than at each of the ones that write. The branches that
    // do not write still act on the path - one of them deleted the link outright - and a refusal
    // that holds only where it was remembered is not a refusal. `existsSync` follows a link, so no
    // branch can be trusted to notice one on its own.
    refuseSymlinkAt(entry.targetPath);
    if (!existsSync(entry.generatedPath)) {
      if (entry.overlay && existsSync(entry.targetPath)) {
        logger?.success(`${entry.label} (preserved)`);
        return;
      }
      if (entry.preservedConfig !== undefined) {
        writeDestinationFile(entry.targetPath, serializeMergeableConfig(entry.targetPath, entry.preservedConfig));
        logger?.success(`${entry.label} (preserved)`);
      } else if (existsSync(entry.targetPath)) {
        removePath(entry.targetPath);
        logger?.success(`${entry.label} (removed)`);
      }
      return;
    }

    if (entry.preservedConfig === undefined) {
      copyDestinationFile(entry.generatedPath, entry.targetPath);
      logger?.success(`${entry.label} (copied)`);
      return;
    }

    const generatedContent = readFile(entry.generatedPath);
    const generated = readMergeableConfig(entry.generatedPath);
    const merged = mergeConfigValues(entry.preservedConfig, generated);
    if (entry.overlay === "toml") {
      const existingContent = entry.originalContent ?? readFile(entry.targetPath);
      writeDestinationFile(entry.targetPath, patchTomlOverlay(existingContent, generatedContent, merged));
    } else {
      writeDestinationFile(entry.targetPath, serializeMergeableConfig(entry.targetPath, merged));
    }
    logger?.success(`${entry.label} (merged)`);
  } catch (error) {
    // Passed through rather than wrapped: its message names the file and the fix, and this wrapper
    // would hide both behind the path pair.
    if (error instanceof UnsafeNativeConfigPathError) throw error;
    throw new Error(`Failed to merge preserved native config ${entry.generatedPath} -> ${entry.targetPath}`, {
      cause: error,
    });
  }
}

function removePath(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
