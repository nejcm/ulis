/**
 * Generates docs/REFERENCE.md from the ULIS Zod schemas.
 * Each top-level schema becomes a section with a field table.
 *
 * Usage: bun run gen:reference
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { zodToJsonSchema } from "zod-to-json-schema";

import { AgentFrontmatterSchema, McpConfigSchema, PluginsConfigSchema, SkillFrontmatterSchema } from "../schema.js";

const outDir = resolve(join(import.meta.dirname, "../..", "docs"));
mkdirSync(outDir, { recursive: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchemaProperty>;
  items?: JsonSchemaProperty;
  anyOf?: JsonSchemaProperty[];
  $ref?: string;
}

interface JsonSchemaObject {
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  definitions?: Record<string, JsonSchemaObject>;
}

function formatType(prop: JsonSchemaProperty): string {
  if (prop.enum) return prop.enum.map((v) => `\`"${v}"\``).join(" \\| ");
  if (prop.anyOf) {
    return prop.anyOf.map((p) => formatType(p)).join(" \\| ");
  }
  if (Array.isArray(prop.type)) return prop.type.join(" \\| ");
  if (prop.type === "array" && prop.items) return `${formatType(prop.items)}[]`;
  if (prop.type === "object") return "object";
  if (prop.type) return `\`${prop.type}\``;
  return "any";
}

function formatDefault(val: unknown): string {
  if (val === undefined || val === null) return "";
  return `\`${JSON.stringify(val)}\``;
}

function renderPropertiesTable(properties: Record<string, JsonSchemaProperty>, required: string[], depth = 0): string {
  const indent = depth > 0 ? `${"  ".repeat(depth)}` : "";
  const rows: string[] = [];

  for (const [key, prop] of Object.entries(properties)) {
    const req = required.includes(key) ? "✓" : "";
    const type = formatType(prop);
    const def = formatDefault(prop.default);
    const desc = (prop.description ?? "").replace(/\n/g, " ").trim();
    rows.push(`| ${indent}\`${key}\` | ${type} | ${req} | ${def} | ${desc} |`);

    // Recurse into nested objects
    if (prop.type === "object" && prop.properties) {
      rows.push(renderPropertiesTable(prop.properties, [], depth + 1));
    }
  }
  return rows.join("\n");
}

function renderSection(title: string, schema: unknown): string {
  const json = zodToJsonSchema(schema as Parameters<typeof zodToJsonSchema>[0], {
    name: title,
    $refStrategy: "none",
    errorMessages: false,
  }) as JsonSchemaObject;

  const lines: string[] = [];
  lines.push(`## ${title}`);
  lines.push("");
  if (json.description) {
    lines.push(json.description);
    lines.push("");
  }

  const props = json.properties ?? {};
  const required = json.required ?? [];

  if (Object.keys(props).length > 0) {
    lines.push("| Field | Type | Required | Default | Description |");
    lines.push("|-------|------|----------|---------|-------------|");
    lines.push(renderPropertiesTable(props, required));
  }

  lines.push("");
  return lines.join("\n");
}

// ─── Build document ───────────────────────────────────────────────────────────

const sections = [
  renderSection("Agent", AgentFrontmatterSchema),
  renderSection("Skill", SkillFrontmatterSchema),
  renderSection("MCP Config", McpConfigSchema),
  renderSection("Plugins Config", PluginsConfigSchema),
];

const header = `# ULIS Field Reference

> Auto-generated from Zod schemas. Do not edit manually — run \`bun run gen:reference\` to regenerate.

This document lists every field for each ULIS entity type.
For narrative explanation of how entities relate and how the build pipeline works, see [SPEC.md](./SPEC.md).

`;

const content = header + sections.join("\n");
const outPath = join(outDir, "REFERENCE.md");
writeFileSync(outPath, content);
console.log(`  wrote docs/REFERENCE.md`);
