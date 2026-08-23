import { toTomlKey } from "../../shared/keys.js";
import { quoteYamlString } from "../../shared/yaml.js";

export const EFFORT_MAP: Record<string, string> = { low: "low", medium: "medium", high: "high", max: "max" };

export function toTomlString(value: string): string {
  return JSON.stringify(value).replaceAll("\u007f", "\\u007f");
}

export function toTomlMultilineString(value: string): string {
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"""', '""\\"')
    .replace(/\r(?!\n)|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, (char) =>
      char === "\r" ? "\\r" : `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  return `"""\n${escaped}\\\n"""`;
}

/**
 * Quote a string for the YAML files this platform emits. Delegates to the shared serializer's
 * escaping so a value cannot carry a line break — including the separators a YAML 1.1 reader
 * breaks on — into `agents/openai.yaml`.
 */
export function toYamlString(value: string): string {
  return quoteYamlString(value);
}

export function emitTomlExtra(lines: string[], extra: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      lines.push(`${toTomlKey(key)} = ${toTomlString(value)}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      lines.push(`${toTomlKey(key)} = ${value}`);
    } else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      const items = (value as string[]).map((v) => toTomlString(v)).join(", ");
      lines.push(`${toTomlKey(key)} = [${items}]`);
    }
  }
}
