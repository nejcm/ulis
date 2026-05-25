import { relative } from "node:path";

import { ZodError } from "zod";

import { isPlatform } from "./platforms.js";
import type { Diagnostic, DiagnosticOrigin, DiagnosticTarget } from "./types.js";

export interface DiagnosticContext {
  readonly source?: string;
  readonly sourceDir?: string;
  readonly relativeFile?: string;
  readonly absoluteFile?: string;
  readonly content?: string;
  readonly lineOffset?: number;
  readonly parserLineOffset?: number;
  readonly isJson?: boolean;
  readonly kind?: string;
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const lines = [`[${diagnostic.entity}] ${diagnostic.message}`];
  const details = [
    ["source", diagnostic.source],
    ["file", diagnostic.relativeFile ?? diagnostic.file],
    ["path", diagnostic.absoluteFile],
    ["field", diagnostic.fieldPath],
    ["target", diagnostic.target],
    ["at", formatLineColumn(diagnostic)],
    ["fix", diagnostic.suggestion],
  ].filter(([, value]) => value != null && value !== "");

  for (const [label, value] of details) {
    lines.push(`  ${label}: ${value}`);
  }

  return lines.join("\n");
}

export function diagnosticFromError(
  level: Diagnostic["level"],
  entity: string,
  message: string,
  options: DiagnosticOrigin & { readonly kind?: string; readonly suggestion?: string },
): Diagnostic {
  return {
    level,
    kind: options.kind,
    file: options.relativeFile,
    entity,
    message,
    suggestion: options.suggestion,
    source: options.source,
    relativeFile: options.relativeFile,
    absoluteFile: options.absoluteFile,
    fieldPath: options.fieldPath,
    target: options.target,
    line: options.line,
    column: options.column,
  };
}

export function deriveDiagnosticOrigin(cause: unknown, context: DiagnosticContext): DiagnosticOrigin {
  const zodIssue = cause instanceof ZodError ? cause.issues[0] : undefined;
  const path = zodIssue?.path ?? [];
  const fieldPath = path.length > 0 ? formatFieldPath(path) : undefined;
  const position = derivePosition(cause, path, context);

  return {
    source: context.source ?? "base",
    relativeFile: context.relativeFile ?? relativePath(context),
    absoluteFile: context.absoluteFile,
    fieldPath,
    target: targetFor(context.kind, fieldPath),
    line: position?.line,
    column: position?.column,
  };
}

export function formatCause(cause: unknown): string {
  if (cause instanceof ZodError) {
    return cause.issues.map((issue) => `${formatFieldPath(issue.path) || "(root)"} - ${issue.message}`).join("; ");
  }
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

export function suggestFix(cause: unknown): string | undefined {
  if (!(cause instanceof ZodError)) return undefined;
  const issue = cause.issues[0];
  if (!issue) return undefined;

  const field = formatFieldPath(issue.path) || "the root value";
  if (issue.code === "invalid_type" && "received" in issue && issue.received === "undefined") {
    return `Add required field "${field}".`;
  }
  if (issue.code === "invalid_type" && issue.message.includes("undefined")) {
    return `Add required field "${field}".`;
  }
  if (issue.code === "invalid_value") {
    return `Use a supported value for "${field}".`;
  }
  if (field.includes("model")) {
    return `Use a string model id for "${field}".`;
  }

  return `Fix "${field}" to match the documented schema.`;
}

export function withOrigin(
  origin: DiagnosticOrigin | undefined,
  overrides: Partial<DiagnosticOrigin>,
): DiagnosticOrigin {
  return {
    source: origin?.source ?? overrides.source ?? "base",
    relativeFile: overrides.relativeFile ?? origin?.relativeFile,
    absoluteFile: overrides.absoluteFile ?? origin?.absoluteFile,
    fieldPath: overrides.fieldPath ?? origin?.fieldPath,
    target: overrides.target ?? origin?.target,
    line: overrides.line ?? origin?.line,
    column: overrides.column ?? origin?.column,
  };
}

function formatLineColumn(diagnostic: Diagnostic): string | undefined {
  if (diagnostic.line == null) return undefined;
  return diagnostic.column == null ? String(diagnostic.line) : `${diagnostic.line}:${diagnostic.column}`;
}

function relativePath(context: DiagnosticContext): string | undefined {
  if (!context.sourceDir || !context.absoluteFile) return undefined;
  return relative(context.sourceDir, context.absoluteFile).replace(/\\/g, "/");
}

function derivePosition(
  cause: unknown,
  path: readonly (string | number | symbol)[],
  context: DiagnosticContext,
): { line: number; column?: number } | undefined {
  const direct = positionFromError(cause, context.parserLineOffset ?? context.lineOffset ?? 1);
  if (direct) return direct;

  if (context.isJson && cause instanceof SyntaxError && context.content) {
    return positionFromJsonError(cause, context.content);
  }

  if (path.length === 0 || !context.content) return undefined;
  return positionFromFieldPath(context.content, path, context.lineOffset ?? 1);
}

function positionFromError(cause: unknown, lineOffset: number): { line: number; column?: number } | undefined {
  if (cause == null || typeof cause !== "object") return undefined;
  const record = cause as Record<string, unknown>;
  const mark = record.mark as Record<string, unknown> | undefined;
  if (typeof mark?.line === "number") {
    return {
      line: mark.line + lineOffset,
      column: typeof mark.column === "number" ? mark.column + 1 : undefined,
    };
  }
  const linePos = record.linePos as readonly Record<string, unknown>[] | undefined;
  const first = linePos?.[0];
  if (typeof first?.line === "number") {
    return {
      line: first.line,
      column: typeof first.col === "number" ? first.col : undefined,
    };
  }
  if (typeof record.line === "number") {
    return {
      line: record.line + lineOffset - 1,
      column: typeof record.column === "number" ? record.column : undefined,
    };
  }
  return undefined;
}

function positionFromJsonError(error: SyntaxError, content: string): { line: number; column: number } | undefined {
  const match = /position (\d+)/u.exec(error.message);
  if (!match) return undefined;
  const position = Number(match[1]);
  if (!Number.isFinite(position)) return undefined;
  const before = content.slice(0, position);
  const lines = before.split(/\r?\n/u);
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function positionFromFieldPath(
  content: string,
  path: readonly (string | number | symbol)[],
  lineOffset: number,
): { line: number; column: number } | undefined {
  const keys = path.filter((part): part is string => typeof part === "string");
  if (keys.length === 0) return undefined;
  const wanted = keys.at(-1);
  if (!wanted) return undefined;

  const lines = content.split(/\r?\n/u);
  const pattern = new RegExp(`^\\s*${escapeRegExp(wanted)}\\s*:`, "u");
  const index = lines.findIndex((line) => pattern.test(line));
  if (index < 0) return undefined;
  return {
    line: index + lineOffset,
    column: lines[index]!.search(/\S/u) + 1,
  };
}

function formatFieldPath(path: readonly (string | number | symbol)[]): string {
  const parts: string[] = [];
  for (const segment of path) {
    if (typeof segment === "number") {
      const last = parts.pop();
      parts.push(`${last ?? ""}[]`);
    } else {
      parts.push(String(segment));
    }
  }
  return parts.join(".");
}

function targetFor(kind: string | undefined, fieldPath: string | undefined): DiagnosticTarget {
  if (!fieldPath) return "none";
  const parts = fieldPath.split(".");

  if (parts[0] === "platforms" && parts[1] && isPlatform(parts[1])) return parts[1];
  if ((kind === "permissions" || kind === "skills" || kind === "extensions") && parts[0]) {
    if (parts[0] === "*") return "all";
    if (isPlatform(parts[0])) return parts[0];
  }
  if (kind === "config") return "none";
  return "all";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
