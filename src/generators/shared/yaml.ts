/**
 * YAML serialization helpers shared by platform generators that emit YAML frontmatter.
 * Used by: claude, opencode.
 */

/**
 * Returns `value` as a YAML scalar, quoting it when the bare form would be
 * ambiguous or invalid (special characters, reserved words, whitespace, etc.).
 */
export function toYamlScalar(value: string): string {
  const needsQuotes =
    value.length === 0 ||
    /[\n\r\t#{}[\],&*!|>'"%@`\\]/u.test(value) ||
    /^[-?:]/u.test(value) ||
    /:\s/u.test(value) ||
    /^\s|\s$/u.test(value) ||
    /^(true|false|null|~)$/iu.test(value);
  return needsQuotes ? JSON.stringify(value) : value;
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
      lines.push(`${key}: ${toYamlScalar(value)}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${typeof item === "string" ? toYamlScalar(item) : String(item)}`);
      }
    }
  }
  return lines;
}

/**
 * Serialize a flat key→value record as a YAML frontmatter block
 * (delimited by `---`). Supports string scalars, numbers, booleans, and
 * top-level string arrays. Skips `null`/`undefined` entries.
 */
export function serializeYamlFrontmatter(data: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${typeof item === "string" ? toYamlScalar(item) : String(item)}`);
      }
      continue;
    }
    if (typeof value === "string") {
      lines.push(`${key}: ${toYamlScalar(value)}`);
      continue;
    }
    lines.push(`${key}: ${value}`);
  }
  lines.push("---");
  return lines.join("\n");
}
