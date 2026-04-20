import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import { fileExists, readFile } from "./fs.js";

/**
 * Load a structured config file. Tries `<baseName>.yaml` first, then
 * `<baseName>.yml`, then `<baseName>.json`. Returns `undefined` if none exist.
 *
 * YAML is preferred for the ulis config tree. JSON remains supported as a
 * fallback to ease migration from pre-1.0 `.ai/global/` trees.
 */
export function loadConfigFile(dir: string, baseName: string): unknown | undefined {
  const candidates = [`${baseName}.yaml`, `${baseName}.yml`, `${baseName}.json`];

  for (const candidate of candidates) {
    const filePath = join(dir, candidate);
    if (!fileExists(filePath)) continue;

    const content = readFile(filePath);
    try {
      if (candidate.endsWith(".json")) {
        return JSON.parse(content) as unknown;
      }
      return parseYaml(content) as unknown;
    } catch (err) {
      throw new Error(`Failed to parse ${filePath}: ${(err as Error).message}`);
    }
  }

  return undefined;
}

/**
 * Like `loadConfigFile`, but throws when no file is found.
 */
export function loadRequiredConfigFile(dir: string, baseName: string): unknown {
  const value = loadConfigFile(dir, baseName);
  if (value === undefined) {
    throw new Error(`Required config file not found: ${baseName}.{yaml,yml,json} in ${dir}`);
  }
  return value;
}
