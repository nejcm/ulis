export const EFFORT_MAP: Record<string, string> = { low: "low", medium: "medium", high: "high", max: "max" };

export function toTomlString(value: string): string {
  return JSON.stringify(value);
}

export function toYamlString(value: string): string {
  return JSON.stringify(value);
}

export function emitTomlExtra(lines: string[], extra: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      lines.push(`${key} = ${toTomlString(value)}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      lines.push(`${key} = ${value}`);
    } else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      const items = (value as string[]).map((v) => toTomlString(v)).join(", ");
      lines.push(`${key} = [${items}]`);
    }
  }
}
