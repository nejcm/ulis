import { CommandFrontmatterSchema, type CommandFrontmatter } from "../schema.js";
import { ParseError, readMarkdownDir } from "./_shared.js";

export interface ParsedCommand {
  name: string; // filename without .md
  filename: string; // full filename including .md
  frontmatter: CommandFrontmatter;
  body: string;
}

/**
 * Parse and validate command markdown definitions from the commands directory.
 */
export function parseCommands(commandsDir: string): readonly ParsedCommand[] {
  const { items, errors } = readMarkdownDir(
    commandsDir,
    CommandFrontmatterSchema,
    "command",
    (name, frontmatter, body, relFile) => ({ name, filename: relFile, frontmatter, body }),
  );
  if (errors.length > 0) throw errors[0] as ParseError;
  return items;
}
