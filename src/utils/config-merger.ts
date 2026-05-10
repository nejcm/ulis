import { readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import * as smolToml from "smol-toml";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

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
