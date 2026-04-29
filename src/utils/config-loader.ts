import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import type { z } from "zod";

import { fileExists, readFile } from "./fs.js";

interface BaseValidatedConfigOptions<T> {
  readonly dir: string;
  readonly baseName: string;
  readonly schema: z.ZodType<T>;
}

type RequiredValidatedConfigOptions<T> = BaseValidatedConfigOptions<T> & {
  readonly required: true;
  readonly defaultValue?: never;
};

type DefaultedValidatedConfigOptions<T> = BaseValidatedConfigOptions<T> & {
  readonly required?: false;
  readonly defaultValue: T;
};

type OptionalValidatedConfigOptions<T> = BaseValidatedConfigOptions<T> & {
  readonly required?: false;
  readonly defaultValue?: undefined;
};

/**
 * Load a structured config file. Tries `<baseName>.yaml` first, then
 * `<baseName>.yml`, then `<baseName>.json`. Returns `undefined` if none exist.
 *
 * YAML is preferred for the ulis config tree. JSON remains supported as a
 * fallback for legacy JSON-based layouts.
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

export function loadValidatedConfigFile<T>(options: RequiredValidatedConfigOptions<T>): T;
export function loadValidatedConfigFile<T>(options: DefaultedValidatedConfigOptions<T>): T;
export function loadValidatedConfigFile<T>(options: OptionalValidatedConfigOptions<T>): T | undefined;
export function loadValidatedConfigFile<T>(
  options: RequiredValidatedConfigOptions<T> | DefaultedValidatedConfigOptions<T> | OptionalValidatedConfigOptions<T>,
): T | undefined {
  const raw = options.required
    ? loadRequiredConfigFile(options.dir, options.baseName)
    : loadConfigFile(options.dir, options.baseName);

  if (raw === undefined) {
    if ("defaultValue" in options) return options.schema.parse(options.defaultValue);
    return undefined;
  }

  return options.schema.parse(raw);
}
