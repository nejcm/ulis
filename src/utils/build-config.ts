import { join } from "node:path";

import { BUILD_CONFIG, type BuildConfig } from "../config.js";
import { fileExists, readFile } from "./fs.js";

/**
 * Load `.ai/build.config.json` (if present) and deep-merge it over the
 * code defaults from `BUILD_CONFIG`. The user file may be a partial — only
 * the leaves you specify are overridden.
 *
 * The result is always a fully-resolved `BuildConfig`. Returns `BUILD_CONFIG`
 * unchanged when no override file exists.
 */
export function loadBuildConfig(aiDir: string): BuildConfig {
  const overridePath = join(aiDir, "build.config.json");
  if (!fileExists(overridePath)) {
    return BUILD_CONFIG;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFile(overridePath));
  } catch (err) {
    throw new Error(`Failed to parse .ai/build.config.json: ${(err as Error).message}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error(".ai/build.config.json must be a JSON object");
  }

  return deepMerge(BUILD_CONFIG, parsed) as BuildConfig;
}

/**
 * Recursive immutable deep merge. Plain objects are merged key-by-key,
 * everything else (arrays, primitives, functions) is replaced wholesale.
 *
 * Crucially, the inputs are never mutated; every container is a fresh copy.
 */
export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : (override as T);
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
