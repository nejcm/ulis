import matter from "gray-matter";

/**
 * gray-matter's built-in `javascript` engine `eval`s a `---js` block with `require` in scope, so a
 * remote source could run code during parsing, before any trust gate. Every parse goes through here.
 */
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

export const stringifyFrontmatter = matter.stringify;
