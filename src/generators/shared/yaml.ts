/**
 * YAML serialization helpers shared by platform generators that emit YAML frontmatter.
 * Used by: claude, cursor, forgecode, opencode.
 */

import { toYamlKey, yamlScalarResolvesNonString } from "./keys.js";

/**
 * Returns `value` as a YAML scalar, quoting it when the bare form would be
 * ambiguous or invalid (special characters, reserved words, whitespace, etc.).
 */
export function toYamlScalar(value: string): string {
  const needsQuotes =
    value.length === 0 ||
    /[\u0000-\u001f\u007f-\u009f\ud800-\udfff#{}[\],&*!|>'"%@`\\]/u.test(value) ||
    /^[-?:]/u.test(value) ||
    /:(?:\s|$)/u.test(value) ||
    yamlScalarResolvesNonString(value) ||
    /^\s|\s$/u.test(value);
  return needsQuotes ? quoteYamlString(value) : value;
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value).replace(
    /[\u007f-\u009f]/gu,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Serialize extra (unknown) platform fields as YAML lines.
 * Handles strings, numbers, booleans, and flat arrays. Skips null/undefined/objects.
 */
export function extraToYamlLines(extra: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      lines.push(`${toYamlKey(key)}: ${toYamlScalar(value)}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      lines.push(`${toYamlKey(key)}: ${value}`);
    } else if (Array.isArray(value)) {
      lines.push(`${toYamlKey(key)}:`);
      for (const item of value) {
        lines.push(`  - ${typeof item === "string" ? toYamlScalar(item) : String(item)}`);
      }
    }
  }
  return lines;
}

/** Serialize a key→value record as a YAML frontmatter block. */
export function serializeYamlFrontmatter(data: Record<string, unknown>): string {
  const lines = ["---"];
  appendObject(lines, data, 0, new WeakSet([data]));
  lines.push("---");
  return lines.join("\n");
}

function appendObject(
  lines: string[],
  data: Record<string, unknown>,
  indent: number,
  ancestors: WeakSet<object>,
): void {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    const prefix = `${" ".repeat(indent)}${toYamlKey(key)}:`;
    appendValue(lines, prefix, value, indent, ancestors);
  }
}

function appendValue(
  lines: string[],
  prefix: string,
  value: unknown,
  indent: number,
  ancestors: WeakSet<object>,
): void {
  if (indent >= 200) throw new Error("Cannot serialize YAML frontmatter deeper than 100 levels");
  if (value === null || typeof value !== "object" || value instanceof Date) {
    lines.push(`${prefix} ${scalar(value)}`);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== null && prototype !== Object.prototype) {
    throw new Error("Cannot serialize non-plain YAML frontmatter value");
  }
  if (ancestors.has(value)) throw new Error("Cannot serialize cyclic YAML frontmatter");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length === 0) return void lines.push(`${prefix} []`);
      lines.push(prefix);
      for (const item of value) appendArrayItem(lines, item, indent + 2, ancestors);
    } else {
      const entries = Object.entries(value).filter(([, nested]) => nested !== undefined);
      if (entries.length === 0) return void lines.push(`${prefix} {}`);
      lines.push(prefix);
      appendObject(lines, Object.fromEntries(entries), indent + 2, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function appendArrayItem(lines: string[], value: unknown, indent: number, ancestors: WeakSet<object>): void {
  const prefix = `${" ".repeat(indent)}-`;
  if (value === undefined) return void lines.push(`${prefix} null`);
  appendValue(lines, prefix, value, indent, ancestors);
}

function scalar(value: unknown): string {
  if (typeof value === "string") return toYamlScalar(value);
  if (value instanceof Date) return toYamlScalar(value.toISOString());
  if (value === null) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") {
    if (Number.isNaN(value)) return ".nan";
    if (value === Number.POSITIVE_INFINITY) return ".inf";
    if (value === Number.NEGATIVE_INFINITY) return "-.inf";
    return String(value);
  }
  throw new Error(`Cannot serialize ${typeof value} YAML frontmatter value`);
}
