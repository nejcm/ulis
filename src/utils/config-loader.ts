import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { ZodError, type z } from "zod";

import { fileExists, readFile } from "./fs.js";

function formatSchemaError(cause: unknown): string {
  if (cause instanceof ZodError) {
    return cause.issues.map((i) => `${i.path.join(".") || "(root)"} — ${i.message}`).join("; ");
  }
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/**
 * Run `schema.parse(raw)` and attach `baseName` + resolved file path to validation errors.
 */
export function parseConfigOrThrow<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  baseName: string,
  filePath: string | undefined,
): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    const location = filePath ?? `${baseName}.{yaml,yml,json}`;
    throw new Error(`Failed to validate ${baseName} (${location}): ${formatSchemaError(err)}`);
  }
}

function configCandidates(baseName: string): readonly string[] {
  return [`${baseName}.yaml`, `${baseName}.yml`, `${baseName}.json`];
}

/**
 * Absolute path to the first existing file that {@link loadConfigFile} would read
 * (same `.yaml` → `.yml` → `.json` precedence).
 */
export function resolveLoadedConfigPath(dir: string, baseName: string): string | undefined {
  for (const candidate of configCandidates(baseName)) {
    const filePath = join(dir, candidate);
    if (fileExists(filePath)) return filePath;
  }
  return undefined;
}

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
  for (const candidate of configCandidates(baseName)) {
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

  const filePath = resolveLoadedConfigPath(options.dir, options.baseName);
  return parseConfigOrThrow(options.schema, raw, options.baseName, filePath);
}
