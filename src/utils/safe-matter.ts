import matter from "gray-matter";

// Reject JavaScript frontmatter before a remote source reaches the trust gate.
const SAFE_OPTIONS = {
  engines: {
    javascript: {
      parse(): never {
        throw new Error("JavaScript frontmatter (---js) is not supported.");
      },
    },
  },
};

export function parseFrontmatter(raw: string): matter.GrayMatterFile<string> {
  return matter(raw, SAFE_OPTIONS);
}

export function stringifyFrontmatter(content: string, data: Record<string, unknown>): string {
  return matter.stringify({ content }, data, SAFE_OPTIONS);
}
