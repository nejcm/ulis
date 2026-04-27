import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import matter from "gray-matter";
import { ZodError, type ZodSchema } from "zod";

import { readFile } from "../utils/fs.js";

export class ParseError extends Error {
  constructor(
    readonly kind: string,
    readonly file: string,
    cause: unknown,
  ) {
    super(`${file}: ${formatCause(cause)}`);
    this.name = "ParseError";
  }
}

export class ParseAggregateError extends Error {
  constructor(readonly errors: readonly ParseError[]) {
    super(`Parse errors (${errors.length}):\n${errors.map((e) => `  ${e.message}`).join("\n")}`);
    this.name = "ParseAggregateError";
  }
}

function formatCause(cause: unknown): string {
  if (cause instanceof ZodError) {
    return cause.issues.map((i) => `${i.path.join(".") || "(root)"} — ${i.message}`).join("; ");
  }
  if (cause instanceof Error) return cause.message;
  return String(cause);
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
  build: (name: string, frontmatter: TFrontmatter, body: string, relFile: string) => TItem,
  opts?: { recursive?: boolean },
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
    try {
      const raw = readFile(join(dir, relFile));
      const { data, content } = matter(raw);
      const frontmatter = schema.parse(data);
      const name = opts?.recursive ? relFile.replace(/\.md$/, "") : basename(relFile, ".md");
      items.push(build(name, frontmatter, content.trim(), relFile));
    } catch (err) {
      errors.push(new ParseError(kind, relFile, err));
    }
  }

  return { items, errors };
}
