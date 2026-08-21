/**
 * Generates docs/REFERENCE.md from the ULIS Zod schemas.
 * Each top-level schema becomes a section with a field table.
 *
 * Usage: bun run gen:reference
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { z } from "zod";

import {
  AgentFrontmatterSchema,
  ExtensionsConfigSchema,
  McpConfigSchema,
  PresetMetaSchema,
  SkillFrontmatterSchema,
  SkillsConfigSchema,
} from "../schema.js";

const outDir = resolve(join(import.meta.dirname, "../..", "docs"));
mkdirSync(outDir, { recursive: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface JsonSchemaNode {
  type?: string | string[];
  description?: string;
  default?: unknown;
  const?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
  additionalProperties?: JsonSchemaNode | boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  format?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchemaNode>;
  definitions?: Record<string, JsonSchemaNode>;
}

/** How many enum members are spelled out before the type collapses to a count. */
const ENUM_INLINE_LIMIT = 6;
/** Guard against pathological nesting; ULIS schemas stay well under this. */
const MAX_DEPTH = 4;
/** `z.int()` emits the safe-integer range as bounds; those carry no information here. */
const SAFE_INT_BOUNDS = new Set<number>([Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]);

/** Escapes the characters that would break out of a Markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function code(text: string): string {
  return `\`${text}\``;
}

/** Resolves `$ref` pointers back to the `$defs`/`definitions` block of the root schema. */
function deref(node: JsonSchemaNode, root: JsonSchemaNode): JsonSchemaNode {
  if (!node.$ref) return node;
  const name = node.$ref.replace(/^#\/(?:\$defs|definitions)\//, "");
  const target = root.$defs?.[name] ?? root.definitions?.[name];
  return target ? { ...target, ...node, $ref: undefined } : node;
}

function isObjectNode(node: JsonSchemaNode): boolean {
  return node.type === "object" || node.properties !== undefined;
}

/** Record schemas (`z.record`) carry their value shape on `additionalProperties`. */
function recordValue(node: JsonSchemaNode): JsonSchemaNode | undefined {
  const extra = node.additionalProperties;
  if (!extra || typeof extra === "boolean") return undefined;
  if (node.properties && Object.keys(node.properties).length > 0) return undefined;
  return extra;
}

function formatType(node: JsonSchemaNode, root: JsonSchemaNode): string {
  const n = deref(node, root);
  if (n.const !== undefined) return code(JSON.stringify(n.const));
  if (n.enum) {
    if (n.enum.length <= ENUM_INLINE_LIMIT) return n.enum.map((v) => code(JSON.stringify(v))).join(" \\| ");
    return `${code("string")} — one of ${n.enum.length} values`;
  }
  if (n.anyOf) {
    const parts = n.anyOf.map((p) => formatType(p, root));
    return [...new Set(parts)].join(" \\| ");
  }
  if (n.allOf?.length) return n.allOf.map((p) => formatType(p, root)).join(" & ");
  if (Array.isArray(n.type)) return n.type.map((t) => code(t)).join(" \\| ");
  if (n.type === "array") return n.items ? `${formatType(n.items, root)}[]` : `${code("array")}`;
  if (isObjectNode(n)) {
    const value = recordValue(n);
    if (value) return `${code("object")} — map of ${formatType(value, root)}`;
    return code("object");
  }
  if (n.type) return code(n.type);
  return code("any");
}

function formatConstraints(node: JsonSchemaNode, root: JsonSchemaNode): string {
  const n = deref(node, root);
  const parts: string[] = [];
  if (n.format) parts.push(`format ${n.format}`);
  if (n.minLength !== undefined && n.maxLength !== undefined) parts.push(`length ${n.minLength}–${n.maxLength}`);
  else if (n.minLength !== undefined) parts.push(`min length ${n.minLength}`);
  else if (n.maxLength !== undefined) parts.push(`max length ${n.maxLength}`);
  if (n.minimum !== undefined && !SAFE_INT_BOUNDS.has(n.minimum)) parts.push(`≥ ${n.minimum}`);
  if (n.maximum !== undefined && !SAFE_INT_BOUNDS.has(n.maximum)) parts.push(`≤ ${n.maximum}`);
  if (n.exclusiveMinimum !== undefined) parts.push(`> ${n.exclusiveMinimum}`);
  if (n.exclusiveMaximum !== undefined) parts.push(`< ${n.exclusiveMaximum}`);
  if (n.minItems !== undefined) parts.push(`min ${n.minItems} item(s)`);
  if (n.maxItems !== undefined) parts.push(`max ${n.maxItems} item(s)`);
  if (n.pattern) parts.push(`pattern ${code(n.pattern)}`);
  return parts.join(", ");
}

function formatDefault(val: unknown): string {
  if (val === undefined) return "";
  return code(JSON.stringify(val));
}

function row(label: string, node: JsonSchemaNode, required: boolean, root: JsonSchemaNode, depth: number): string {
  const indent = depth > 0 ? "&nbsp;".repeat(depth * 4) : "";
  const n = deref(node, root);
  return (
    [
      `| ${indent}${label}`,
      formatType(n, root),
      required ? "✓" : "",
      formatDefault(n.default),
      cell(formatConstraints(n, root)),
      cell(n.description ?? ""),
    ].join(" | ") + " |"
  );
}

/** Emits one row per property, descending into nested objects, records and object arrays. */
function renderRows(node: JsonSchemaNode, root: JsonSchemaNode, depth = 0): string[] {
  if (depth > MAX_DEPTH) return [];
  const n = deref(node, root);
  const rows: string[] = [];

  const value = recordValue(n);
  if (value) {
    const resolved = deref(value, root);
    rows.push(row(code("<key>"), resolved, false, root, depth));
    rows.push(...renderRows(resolved, root, depth + 1));
    return rows;
  }

  const required = new Set(n.required ?? []);
  for (const [key, raw] of Object.entries(n.properties ?? {})) {
    const prop = deref(raw, root);
    rows.push(row(code(key), prop, required.has(key), root, depth));

    if (prop.type === "array" && prop.items) {
      const items = deref(prop.items, root);
      if (isObjectNode(items)) rows.push(...renderRows(items, root, depth + 1));
      continue;
    }
    if (isObjectNode(prop)) rows.push(...renderRows(prop, root, depth + 1));
  }
  return rows;
}

function renderSection(title: string, note: string, schema: z.ZodType): string {
  const root = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as JsonSchemaNode;
  const rows = renderRows(root, root);

  const lines: string[] = [`## ${title}`, ""];
  if (note) lines.push(note, "");
  if (root.description) lines.push(root.description, "");

  if (rows.length > 0) {
    lines.push("| Field | Type | Required | Default | Constraints | Description |");
    lines.push("| ----- | ---- | -------- | ------- | ----------- | ----------- |");
    lines.push(...rows);
  } else {
    lines.push("_This schema declares no fields._");
  }

  lines.push("");
  return lines.join("\n");
}

// ─── Build document ───────────────────────────────────────────────────────────

const sections: Array<{ title: string; note: string; schema: z.ZodType }> = [
  {
    title: "Agent",
    note: "YAML frontmatter of a file under `agents/`.",
    schema: AgentFrontmatterSchema,
  },
  {
    title: "Skill",
    note: "YAML frontmatter of `skills/<name>/SKILL.md`.",
    schema: SkillFrontmatterSchema,
  },
  { title: "MCP Config", note: "Fields of `mcp.yaml`.", schema: McpConfigSchema },
  { title: "Skills Config", note: "Fields of `skills.yaml`.", schema: SkillsConfigSchema },
  {
    title: "Extensions Config",
    note: "Fields of `extensions.yaml`.",
    schema: ExtensionsConfigSchema,
  },
  {
    title: "Preset metadata",
    note: "Fields of `preset.yaml` at the root of a preset source. Display metadata only.",
    schema: PresetMetaSchema,
  },
];

const header = `# ULIS Field Reference

> Auto-generated from Zod schemas. Do not edit manually — run \`bun run gen:reference\` to regenerate.

This document lists every field for each ULIS entity type.
For narrative explanation of how entities relate and how the build pipeline works, see [SPEC.md](./SPEC.md).

Indented rows are nested fields of the row above them. A \`<key>\` row stands for an arbitrary
user-chosen key in a map. Types, defaults and constraints are derived from the schemas; descriptions
appear only for fields the schema annotates.

`;

const content = header + sections.map((s) => renderSection(s.title, s.note, s.schema)).join("\n");
const outPath = join(outDir, "REFERENCE.md");
writeFileSync(outPath, content);
console.log(`  wrote docs/REFERENCE.md`);
