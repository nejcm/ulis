import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import matter from "gray-matter";
import type { ZodSchema } from "zod";

import { deriveDiagnosticOrigin, formatCause, suggestFix } from "../diagnostics.js";
import type { Diagnostic, DiagnosticOrigin } from "../types.js";
import { readFile } from "../utils/fs.js";

export interface ParseErrorOptions {
  readonly source?: string;
  readonly sourceDir?: string;
  readonly relativeFile?: string;
  readonly absoluteFile?: string;
  readonly content?: string;
  readonly lineOffset?: number;
  readonly parserLineOffset?: number;
  readonly isJson?: boolean;
}

export class ParseError extends Error {
  readonly source: string;
  readonly relativeFile?: string;
  readonly absoluteFile?: string;
  readonly fieldPath?: string;
  readonly target?: Diagnostic["target"];
  readonly line?: number;
  readonly column?: number;
  readonly suggestion?: string;

  constructor(
    readonly kind: string,
    readonly file: string,
    cause: unknown,
    options: ParseErrorOptions = {},
  ) {
    super(`${file}: ${formatCause(cause)}`);
    this.name = "ParseError";
    const origin = deriveDiagnosticOrigin(cause, {
      kind,
      ...options,
      relativeFile: options.relativeFile ?? file,
    });
    this.source = origin.source;
    this.relativeFile = origin.relativeFile;
    this.absoluteFile = origin.absoluteFile;
    this.fieldPath = origin.fieldPath;
    this.target = origin.target;
    this.line = origin.line;
    this.column = origin.column;
    this.suggestion = suggestFix(cause);
  }

  toDiagnostic(): Diagnostic {
    return {
      level: "error",
      kind: this.kind,
      file: this.file,
      entity: this.kind,
      message: this.message,
      suggestion: this.suggestion,
      source: this.source,
      relativeFile: this.relativeFile,
      absoluteFile: this.absoluteFile,
      fieldPath: this.fieldPath,
      target: this.target,
      line: this.line,
      column: this.column,
    };
  }
}

export class ParseAggregateError extends Error {
  constructor(readonly errors: readonly ParseError[]) {
    super(`Parse errors (${errors.length}):\n${errors.map((e) => `  ${e.message}`).join("\n")}`);
    this.name = "ParseAggregateError";
  }
}

/**
 * Scans a directory for .md files, parses frontmatter with the given Zod schema,
 * and calls `build` to shape each item. Returns both successful items and per-file
 * ParseErrors so callers can choose to fail-fast or collect-all.
 *
 * Missing directory → { items: [], errors: [] } (uniform across all parsers).
 */
export function readMarkdownDir<TFrontmatter, TItem>(
  dir: string,
  schema: ZodSchema<TFrontmatter>,
  kind: string,
  build: (name: string, frontmatter: TFrontmatter, body: string, relFile: string, origin: DiagnosticOrigin) => TItem,
  opts?: { recursive?: boolean; sourceDir?: string; source?: string; relativePrefix?: string },
): { items: readonly TItem[]; errors: readonly ParseError[] } {
  if (!existsSync(dir)) return { items: [], errors: [] };

  let files: string[];
  if (opts?.recursive) {
    files = (readdirSync(dir, { recursive: true }) as string[])
      .map((f) => f.replace(/\\/g, "/"))
      .filter((f) => f.endsWith(".md") && basename(f).toLowerCase() !== "readme.md");
  } else {
    files = readdirSync(dir).filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md");
  }

  const items: TItem[] = [];
  const errors: ParseError[] = [];

  for (const relFile of files) {
    const relativeFile = opts?.relativePrefix ? `${opts.relativePrefix}/${relFile}` : relFile;
    const absoluteFile = join(dir, relFile);
    let raw: string | undefined;
    try {
      raw = readFile(absoluteFile);
      const { data, content } = matter(raw);
      const frontmatter = schema.parse(data);
      const name = opts?.recursive ? relFile.replace(/\.md$/, "") : basename(relFile, ".md");
      const origin: DiagnosticOrigin = {
        source: opts?.source ?? "base",
        relativeFile,
        absoluteFile,
        target: "all",
      };
      items.push(build(name, frontmatter, content.trim(), relFile, origin));
    } catch (err) {
      errors.push(
        new ParseError(kind, relativeFile, err, {
          source: opts?.source,
          sourceDir: opts?.sourceDir,
          relativeFile,
          absoluteFile,
          content: raw ? frontmatterContent(raw) : undefined,
          lineOffset: 2,
          parserLineOffset: 1,
        }),
      );
    }
  }

  return { items, errors };
}

function frontmatterContent(raw: string): string | undefined {
  if (!raw.startsWith("---")) return undefined;
  const firstNewline = raw.indexOf("\n");
  if (firstNewline < 0) return undefined;
  const end = raw.indexOf("\n---", firstNewline + 1);
  if (end < 0) return raw.slice(firstNewline + 1);
  return raw.slice(firstNewline + 1, end);
}
