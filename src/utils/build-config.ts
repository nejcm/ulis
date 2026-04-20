import { BUILD_CONFIG, type BuildConfig } from "../config.js";
import { loadConfigFile } from "./config-loader.js";

/**
 * Load optional `build.config.{yaml,yml,json}` from `sourceDir` and deep-merge
 * it over the code defaults from `BUILD_CONFIG`. The user file may be a
 * partial — only the leaves you specify are overridden.
 *
 * The result is always a fully-resolved `BuildConfig`. Returns `BUILD_CONFIG`
 * unchanged when no override file exists.
 */
export function loadBuildConfig(sourceDir: string): BuildConfig {
  const parsed = loadConfigFile(sourceDir, "build.config");
  if (parsed === undefined) {
    return BUILD_CONFIG;
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`build.config must be an object`);
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
