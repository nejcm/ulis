import { cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import * as smolToml from "smol-toml";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { PLATFORM_DIRS, platformConfigDir, resolvePlatformDirSegment, type Platform } from "../platforms.js";
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
  const ext = extname(filePath).toLowerCase();
  if (!MERGE_EXTS.has(ext)) throw new Error(`Unsupported config extension: ${ext}`);
  if (ext === ".json") {
    writeFile(filePath, JSON.stringify(value, null, 2));
  } else if (ext === ".toml") {
    writeFile(filePath, smolToml.stringify(value as Record<string, smolToml.TomlPrimitive>));
  } else {
    writeFile(filePath, stringifyYaml(value));
  }
}

function mergeOrCopyFile(srcFile: string, destFile: string): void {
  if (!fileExists(destFile) || !isMergeable(destFile)) {
    writeFile(destFile, readFile(srcFile));
    return;
  }

  const rawContent = readFile(srcFile);

  try {
    const generated = readMergeableConfig(destFile);
    const raw = readMergeableConfig(srcFile);
    writeMergeableConfig(destFile, mergeConfigValues(generated, raw));
  } catch (err) {
    console.warn(`[config-merger] merge failed for ${destFile}: ${err}. Copying raw file as-is.`);
    writeFile(destFile, rawContent);
  }
}

export function mergeOrCopyDir(srcDir: string, destDir: string): void {
  if (!fileExists(srcDir)) return;
  ensureDir(destDir);
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry);
    const destPath = join(destDir, entry);
    if (statSync(srcPath).isDirectory()) {
      mergeOrCopyDir(srcPath, destPath);
    } else {
      mergeOrCopyFile(srcPath, destPath);
    }
  }
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

interface PreservedNativeConfigSpec {
  readonly platform: Platform;
  readonly label: string;
  readonly generatedPath: (context: PreservedNativeConfigContext) => string;
  readonly targetPath: (context: PreservedNativeConfigContext) => string;
  readonly preservedPaths: readonly ConfigPath[];
}

export interface PreservedNativeConfigEntry {
  readonly label: string;
  readonly generatedPath: string;
  readonly targetPath: string;
  readonly preservedPaths: readonly ConfigPath[];
}

export interface CapturedPreservedNativeConfig extends PreservedNativeConfigEntry {
  readonly preservedConfig: unknown | undefined;
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
    generatedPath: (context) => join(context.outputDir, "opencode", "opencode.json"),
    targetPath: (context) => join(platformConfigDir("opencode", context.destBase, context.userHome), "opencode.json"),
    preservedPaths: [["mcp"]],
  },
  {
    platform: "claude",
    label: "settings.json",
    generatedPath: (context) => join(context.outputDir, "claude", "settings.json"),
    targetPath: (context) => join(platformConfigDir("claude", context.destBase, context.userHome), "settings.json"),
    preservedPaths: [["hooks"]],
  },
  {
    platform: "claude",
    label: ".claude.json",
    generatedPath: (context) => join(context.outputDir, "claude", ".claude.json"),
    targetPath: (context) => join(context.destBase, ".claude.json"),
    preservedPaths: [["mcpServers"]],
  },
  {
    platform: "codex",
    label: "config.toml",
    generatedPath: (context) => join(context.outputDir, "codex", "config.toml"),
    targetPath: (context) => join(platformConfigDir("codex", context.destBase, context.userHome), "config.toml"),
    preservedPaths: [["projects"], ["hooks"], ["mcp_servers"], ["tui"], ["notice"], ["features"]],
  },
  {
    platform: "cursor",
    label: "mcp.json",
    generatedPath: (context) => join(context.outputDir, "cursor", "mcp.json"),
    targetPath: (context) => join(platformConfigDir("cursor", context.destBase, context.userHome), "mcp.json"),
    preservedPaths: [["mcpServers"]],
  },
  {
    platform: "forgecode",
    label: ".mcp.json",
    generatedPath: (context) =>
      join(context.outputDir, "forgecode", resolvePlatformDirSegment(PLATFORM_DIRS.forgecode.project), ".mcp.json"),
    targetPath: (context) => join(platformConfigDir("forgecode", context.destBase, context.userHome), ".mcp.json"),
    preservedPaths: [["mcpServers"]],
  },
] as const satisfies readonly PreservedNativeConfigSpec[];

export function getPreservedNativeConfigEntries(
  platform: Platform,
  context: PreservedNativeConfigContext,
): readonly PreservedNativeConfigEntry[] {
  return PRESERVED_NATIVE_CONFIGS.filter((spec) => spec.platform === platform).map((spec) => ({
    label: spec.label,
    generatedPath: spec.generatedPath(context),
    targetPath: spec.targetPath(context),
    preservedPaths: spec.preservedPaths,
  }));
}

export function capturePreservedNativeConfigs(
  platform: Platform,
  context: PreservedNativeConfigContext,
): readonly CapturedPreservedNativeConfig[] {
  return getPreservedNativeConfigEntries(platform, context).map((entry) => ({
    ...entry,
    preservedConfig: capturePreservedConfig(entry),
  }));
}

export function writePreservedNativeConfigs(
  entries: readonly CapturedPreservedNativeConfig[],
  logger?: PreservedNativeConfigLogger,
): void {
  for (const entry of entries) {
    writePreservedNativeConfig(entry, logger);
  }
}

function capturePreservedConfig(entry: PreservedNativeConfigEntry): unknown | undefined {
  if (!existsSync(entry.targetPath)) return undefined;
  let preserved: Record<string, unknown>;
  try {
    preserved = pickConfigPaths(readMergeableConfig(entry.targetPath), entry.preservedPaths);
  } catch (error) {
    throw new PreservedNativeConfigParseError(entry.targetPath, error);
  }
  return Object.keys(preserved).length > 0 ? preserved : undefined;
}

export function pickConfigPaths(source: unknown, paths: readonly ConfigPath[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const path of paths) {
    const value = getConfigPath(source, path);
    if (value !== undefined) setConfigPath(result, path, value);
  }
  return result;
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
    if (!existsSync(entry.generatedPath)) {
      if (entry.preservedConfig !== undefined) {
        writeMergeableConfig(entry.targetPath, entry.preservedConfig);
        logger?.success(`${entry.label} (preserved)`);
      } else if (existsSync(entry.targetPath)) {
        removePath(entry.targetPath);
        logger?.success(`${entry.label} (removed)`);
      }
      return;
    }

    if (entry.preservedConfig === undefined) {
      cpSync(entry.generatedPath, entry.targetPath);
      logger?.success(`${entry.label} (copied)`);
      return;
    }

    const generated = readMergeableConfig(entry.generatedPath);
    writeMergeableConfig(entry.targetPath, mergeConfigValues(entry.preservedConfig, generated));
    logger?.success(`${entry.label} (merged)`);
  } catch (error) {
    throw new Error(`Failed to merge preserved native config ${entry.generatedPath} -> ${entry.targetPath}`, {
      cause: error,
    });
  }
}

function removePath(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
