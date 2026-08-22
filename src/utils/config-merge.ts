import {
  closeSync,
  cpSync,
  fchmodSync,
  lstatSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { patch as patchToml, TomlDocument, TomlFormat } from "@decimalturn/toml-patch";
import * as smolToml from "smol-toml";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getConfigPath, isPlainObject } from "./config-paths.js";
import { ensureDir, fileExists, readFile, writeFile } from "./fs.js";

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

export function patchTomlOverlay(existingContent: string, generatedContent: string, merged: unknown): string {
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

/** Split out so a destination write can serialise here and write through `writeDestinationFile` in `preserved-native-configs.ts`. */
export function serializeMergeableConfig(filePath: string, value: unknown): string {
  const ext = extname(filePath).toLowerCase();
  if (!MERGE_EXTS.has(ext)) throw new Error(`Unsupported config extension: ${ext}`);
  if (ext === ".json") return JSON.stringify(value, null, 2);
  if (ext === ".toml") return smolToml.stringify(value as Record<string, smolToml.TomlPrimitive>);
  return stringifyYaml(value);
}

/**
 * Counterpart to `writeDestinationFile` in `preserved-native-configs.ts`, but for the generated tree,
 * which ULIS owns outright and rewrites on every build: a symlink there is replaced rather than
 * refused, since nobody put it there deliberately.
 */
function writeGeneratedFile(filePath: string, content: string | Buffer): void {
  writeFileExclusively(filePath, content);
}

/**
 * Does not refuse a symlink at `filePath` — it unlinks whatever is there and creates fresh in its
 * place. A caller writing into a destination where a symlink could point somewhere else must refuse
 * first: `writeDestinationFile` in `preserved-native-configs.ts` does that before calling this.
 */
export function writeFileExclusively(filePath: string, content: string | Buffer, sourceMode?: number): void {
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

function isSymbolicLink(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Mode of an existing regular file. A directory fails at the write; a symlink is refused by the caller — `writeDestinationFile` in `preserved-native-configs.ts` — before this runs. */
export function existingFileMode(filePath: string): number | undefined {
  try {
    const stats = lstatSync(filePath);
    return stats.isFile() ? stats.mode & 0o7777 : undefined;
  } catch {
    return undefined;
  }
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
    console.warn(`[config-merge] merge failed for ${destFile}: ${err}. Copying raw file as-is.`);
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
