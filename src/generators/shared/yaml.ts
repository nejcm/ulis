/**
 * YAML serialization helpers shared by platform generators that emit YAML frontmatter.
 * Used by: claude, cursor, forgecode, opencode.
 */

import { escapeYamlChars, toYamlKey, yamlScalarResolvesNonString } from "./keys.js";

/**
 * Returns `value` as a YAML scalar, quoting it when the bare form would be
 * ambiguous or invalid (special characters, reserved words, whitespace, etc.).
 */
export function toYamlScalar(value: string): string {
  const needsQuotes =
    value.length === 0 ||
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ud800-\udfff#{}[\],&*!|>'"%@`\\]/u.test(value) ||
    /^[-?:]/u.test(value) ||
    /:(?:\s|$)/u.test(value) ||
    yamlScalarResolvesNonString(value) ||
    /^\s|\s$/u.test(value);
  return needsQuotes ? quoteYamlString(value) : value;
}

/**
 * Render `value` as a double-quoted YAML string. Exported so the Codex YAML writer shares this
 * one escaping path rather than keeping its own copy of the character class.
 */
export function quoteYamlString(value: string): string {
  return escapeYamlChars(JSON.stringify(value));
}

/**
 * Serialize a key→value record as YAML lines, without any document delimiter.
 * Every value goes through the same escaping path, so an unrecognised pass-through
 * field cannot forge a sibling key no matter how deeply it nests.
 */
export function serializeYamlLines(data: Record<string, unknown>): string[] {
  const lines: string[] = [];
  appendObject(lines, data, 0, new WeakSet([data]));
  return lines;
}

/**
 * Render `note` as a YAML comment. A comment runs to the end of the line, so a note carrying a
 * line break would emit a live YAML line; escaping every control character — and the separators a
 * YAML 1.1 reader also breaks on — keeps it on one line however the source spelled the key it names.
 */
export function toYamlComment(note: string): string {
  return `# ${escapeYamlChars(JSON.stringify(note).slice(1, -1))}`;
}

/**
 * Split source-controlled pass-through fields against the keys a generator owns.
 *
 * A colliding extra is dropped rather than merged: the generated value is what the security
 * policy and tool mapping asked for, so letting the source side win would let a source switch
 * off its own restrictions, and emitting both would leave a duplicate key that a last-one-wins
 * consumer resolves in the source's favour. The returned notes make the drop visible in the
 * generated file instead of silent.
 */
export function partitionReservedExtras(
  extra: Record<string, unknown>,
  reserved: Iterable<string>,
): { extras: Record<string, unknown>; notes: string[] } {
  const reservedKeys = new Set(reserved);
  const extras: Record<string, unknown> = {};
  const notes: string[] = [];
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) continue;
    if (reservedKeys.has(key)) {
      // Single quotes keep the key readable in the rendered comment; JSON escaping would double
      // up on double quotes, and the key itself is source-controlled text.
      notes.push(`ULIS dropped the platform field '${key}' because it collides with a generated field.`);
      continue;
    }
    extras[key] = value;
  }
  return { extras, notes };
}

/** Serialize a key→value record as a YAML frontmatter block, prefixed by any comment notes. */
export function serializeYamlFrontmatter(data: Record<string, unknown>, notes: readonly string[] = []): string {
  return ["---", ...notes.map(toYamlComment), ...serializeYamlLines(data), "---"].join("\n");
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
  const start = lines.length;
  appendValue(lines, prefix, value, indent, ancestors);
  // A nested block leaves the dash alone on its line. Fold the first child line up onto it so
  // items read as `- key: value`; the child was indented by two, which the dash now occupies.
  if (lines[start] === prefix && lines.length > start + 1) {
    lines.splice(start, 2, `${prefix} ${lines[start + 1]!.slice(indent + 2)}`);
  }
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
