import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { ZodError, type z } from "zod";

import { ParseError } from "../parsers/_shared.js";
import { fileExists, readFile } from "./fs.js";

export interface ConfigDiagnosticOptions {
  readonly source?: string;
  readonly sourceDir?: string;
}

interface ConfigParseContext extends ConfigDiagnosticOptions {
  readonly content?: string;
  readonly relativeFile?: string;
  readonly isJson?: boolean;
}

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
  diagnostic?: ConfigParseContext,
): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (diagnostic) {
      throw new ParseError(baseName, diagnostic.relativeFile ?? filePath ?? `${baseName}.{yaml,yml,json}`, err, {
        source: diagnostic.source,
        sourceDir: diagnostic.sourceDir,
        relativeFile: diagnostic.relativeFile,
        absoluteFile: filePath,
        content: diagnostic.content,
        lineOffset: 1,
        isJson: diagnostic.isJson,
      });
    }
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
  readonly diagnostic?: ConfigDiagnosticOptions;
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
  return loadConfigEntry(dir, baseName)?.value;
}

interface LoadedConfigEntry {
  readonly value: unknown;
  readonly filePath: string;
  readonly relativeFile: string;
  readonly content: string;
  readonly isJson: boolean;
}

function loadConfigEntry(
  dir: string,
  baseName: string,
  diagnostic?: ConfigDiagnosticOptions,
): LoadedConfigEntry | undefined {
  for (const candidate of configCandidates(baseName)) {
    const filePath = join(dir, candidate);
    if (!fileExists(filePath)) continue;

    const content = readFile(filePath);
    try {
      if (candidate.endsWith(".json")) {
        return { value: JSON.parse(content) as unknown, filePath, relativeFile: candidate, content, isJson: true };
      }
      return { value: parseYaml(content) as unknown, filePath, relativeFile: candidate, content, isJson: false };
    } catch (err) {
      if (diagnostic) {
        throw new ParseError(baseName, candidate, err, {
          source: diagnostic.source,
          sourceDir: diagnostic.sourceDir,
          relativeFile: candidate,
          absoluteFile: filePath,
          content,
          lineOffset: 1,
          isJson: candidate.endsWith(".json"),
        });
      }
      throw new Error(`Failed to parse ${filePath}: ${(err as Error).message}`);
    }
  }

  return undefined;
}

/**
 * Like `loadConfigFile`, but throws when no file is found.
 */
export function loadRequiredConfigFile(dir: string, baseName: string): unknown {
  const value = loadConfigEntry(dir, baseName);
  if (value === undefined) {
    throw new Error(`Required config file not found: ${baseName}.{yaml,yml,json} in ${dir}`);
  }
  return value.value;
}

export function loadValidatedConfigFile<T>(options: RequiredValidatedConfigOptions<T>): T;
export function loadValidatedConfigFile<T>(options: DefaultedValidatedConfigOptions<T>): T;
export function loadValidatedConfigFile<T>(options: OptionalValidatedConfigOptions<T>): T | undefined;
export function loadValidatedConfigFile<T>(
  options: RequiredValidatedConfigOptions<T> | DefaultedValidatedConfigOptions<T> | OptionalValidatedConfigOptions<T>,
): T | undefined {
  const raw = options.required
    ? loadRequiredConfigEntry(options.dir, options.baseName, options.diagnostic)
    : loadConfigEntry(options.dir, options.baseName, options.diagnostic);

  if (raw === undefined) {
    if ("defaultValue" in options) return options.schema.parse(options.defaultValue);
    return undefined;
  }

  const diagnostic = options.diagnostic
    ? {
        ...options.diagnostic,
        relativeFile: raw.relativeFile,
        content: raw.content,
        isJson: raw.isJson,
      }
    : undefined;
  return parseConfigOrThrow(options.schema, raw.value, options.baseName, raw.filePath, diagnostic);
}

function loadRequiredConfigEntry(
  dir: string,
  baseName: string,
  diagnostic?: ConfigDiagnosticOptions,
): LoadedConfigEntry {
  const value = loadConfigEntry(dir, baseName, diagnostic);
  if (value === undefined) {
    throw new Error(`Required config file not found: ${baseName}.{yaml,yml,json} in ${dir}`);
  }
  return value;
}
