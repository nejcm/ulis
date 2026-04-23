import { readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import * as smolToml from "smol-toml";
import { merge } from "ts-deepmerge";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { ensureDir, fileExists, readFile, writeFile } from "./fs.js";

function mergeConfigs(generated: unknown, raw: unknown): unknown {
  return merge.withOptions({ mergeArrays: true, uniqueArrayItems: true }, generated as object, raw as object);
}

const MERGE_EXTS = new Set([".json", ".toml", ".yaml", ".yml"]);

function isMergeable(filePath: string): boolean {
  return MERGE_EXTS.has(extname(filePath).toLowerCase());
}

function mergeOrCopyFile(srcFile: string, destFile: string): void {
  if (!fileExists(destFile) || !isMergeable(destFile)) {
    writeFile(destFile, readFile(srcFile));
    return;
  }

  const ext = extname(destFile).toLowerCase();
  const rawContent = readFile(srcFile);
  const generatedContent = readFile(destFile);

  try {
    let merged: unknown;

    if (ext === ".json") {
      const generated = JSON.parse(generatedContent) as unknown;
      const raw = JSON.parse(rawContent) as unknown;
      merged = mergeConfigs(generated, raw);
      writeFile(destFile, JSON.stringify(merged, null, 2));
    } else if (ext === ".toml") {
      const generated = smolToml.parse(generatedContent);
      const raw = smolToml.parse(rawContent);
      merged = mergeConfigs(generated, raw);
      writeFile(destFile, smolToml.stringify(merged as Record<string, smolToml.TomlPrimitive>));
    } else {
      const generated = parseYaml(generatedContent) as unknown;
      const raw = parseYaml(rawContent) as unknown;
      merged = mergeConfigs(generated, raw);
      writeFile(destFile, stringifyYaml(merged));
    }
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
