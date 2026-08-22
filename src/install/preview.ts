import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import matter from "gray-matter";
import { parse as parseToml } from "smol-toml";

import { analyzePresets, analyzeProject, type Logger } from "../build.js";
import { generate, type GenerationResult, type ProjectBundle } from "../generators/index.js";
import type { Platform } from "../platforms.js";
import type { PermissionsConfig } from "../schema.js";
import { NATIVE_CONFIG_FILENAMES } from "../utils/preserved-native-configs.js";
import { sanitizeLogText } from "../utils/redact.js";
import type { ResolvedPreset } from "../utils/resolve-presets.js";

/**
 * What a source will make the user's agents run, read off the output rather than off the input.
 *
 * The earlier version of this walked the *parsed source* - declared `hooks:`, declared MCP servers,
 * `raw/` files matched by basename. Every hole found in it lived in the gap between what a source
 * declares and what a generator emits: a hook derived from a security policy, an unknown key that a
 * `looseObject` carried into YAML, a table header spliced out of an `mcp.yaml` server name. None of
 * those exist in the source as a hook or a server, and all of them exist in the generated file.
 *
 * So the rule is now: generate, then read the bytes that are about to be installed. A payload that
 * does not survive into the output cannot run; one that does is found whatever shape it entered in.
 * The three inputs to a destination are covered in turn - generated artifacts, trees copied through
 * verbatim (`raw/`, skills, docs), and the approval settings that decide what runs unattended.
 */
export interface PreviewInputs {
  readonly sourceDir?: string;
  readonly presets: readonly ResolvedPreset[];
  readonly platforms: readonly Platform[];
}

const SILENT_LOGGER: Logger = {
  info: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
  dim: () => {},
  header: () => {},
};

/** Files a platform loads and runs by virtue of where they land, whatever they are called. */
const AUTOLOADED_DIRS = new Set(["plugin", "plugins", "hooks"]);

/** Extensions a platform (or a hook it registers) will execute rather than read. */
const CODE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".sh",
  ".bash",
  ".zsh",
  ".py",
  ".rb",
  ".ps1",
  ".bat",
  ".cmd",
]);

/** Native config basenames, lowercased: a case-insensitive filesystem reads `Settings.json` as one. */
const NATIVE_CONFIG_BASENAMES = new Set([...NATIVE_CONFIG_FILENAMES].map((name) => name.toLowerCase()));

/**
 * Settings whose value is a shell command even though the field is not called `command`. Kept
 * deliberately short - only fields confirmed to run something. `statusLine` needs no entry: its
 * value is an object carrying a `command`, so the generic rule already has it.
 */
const EXEC_STRING_KEYS = new Set(["apiKeyHelper"]);

/** A hostile `raw/` file can nest objects deep enough to blow the stack; the walk stops first. */
const MAX_WALK_DEPTH = 64;

/** Nothing is copied file-by-file at this size; reading further only risks a preview no one reads. */
const MAX_SCANNED_BYTES = 512 * 1024;

/**
 * Deliberately a second parse-and-generate pass, not a shortcut over `runBuild`'s output. This
 * calls `mergedProject` (the same parse/merge the build performs) and `generate` again, entirely in
 * memory, so what is previewed is exactly what `generate()` would produce for the same inputs -
 * never what a `generated/` tree on disk happens to hold, which a remote source could have written
 * to directly. Do not "optimise" this into reading the build's output back off disk; that reopens
 * the gap between what is shown and what gets installed that this preview exists to close.
 */
export function previewInstalledExecution(inputs: PreviewInputs): string[] {
  const project = mergedProject(inputs);
  const previews: string[] = [];

  for (const platform of inputs.platforms) {
    const result = generate(platform, project);
    if (!result) continue;
    for (const artifact of result.artifacts) {
      const contents = typeof artifact.contents === "string" ? artifact.contents : artifact.contents.toString("utf8");
      const scan = commandsIn(contents, artifact.path);
      previews.push(...scan.findings.map((finding) => runsLine(platform, artifact.path, finding)));
    }
    previews.push(...copiedTreePreviews(result, platform));
  }

  previews.push(...approvalSettingPreviews(project.permissions));
  // Two platforms can install the same raw fragment; one line each is enough.
  return [...new Set(previews)];
}

function mergedProject(inputs: PreviewInputs): ProjectBundle {
  // The same parse and merge the build performs, so the preview cannot describe a different project.
  return inputs.sourceDir
    ? analyzeProject({ sourceDir: inputs.sourceDir, presets: inputs.presets, logger: SILENT_LOGGER }).project
    : analyzePresets({ presets: inputs.presets, logger: SILENT_LOGGER }).project;
}

/**
 * Every command in one generated file, found by structure rather than by knowing which field of
 * which format holds it: parse the file, then report every object carrying a string `command`.
 * Hook entries, MCP server entries and anything a future platform adds all have that shape - and a
 * file that does not parse is scanned as text rather than trusted.
 */
interface FileScan {
  readonly findings: readonly string[];
  /**
   * True only when the file was parsed as structured data. A text-scan fallback is a heuristic over
   * bytes this module did not understand, and an unreadable file is not a clean one - both have to
   * be reported differently from "read it, found nothing", or a payload the preview could not open
   * prints exactly like a file it read and cleared.
   */
  readonly readable: boolean;
}

function commandsIn(contents: string | undefined, path: string): FileScan {
  if (contents === undefined) return { findings: [], readable: false };
  const parsed = structuredValue(contents, path);
  if (parsed === undefined) return { findings: textScanCommands(contents), readable: false };
  const found: string[] = [];
  walk(parsed, found, 0);
  return { findings: found, readable: true };
}

function structuredValue(contents: string, path: string): unknown {
  try {
    switch (extname(path).toLowerCase()) {
      case ".json":
        return JSON.parse(contents);
      case ".toml":
        return parseToml(contents);
      case ".md":
      case ".mdc":
      case ".markdown": {
        // Only the frontmatter is configuration; the body is prose the agent reads, not runs.
        const { data } = matter(contents);
        return data;
      }
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

function walk(node: unknown, found: string[], depth: number): void {
  // A `raw/` file is attacker-controlled data, and 40,000 nested objects would otherwise end the
  // run with a RangeError from somewhere unrelated. Nothing legitimate is this deep.
  if (depth > MAX_WALK_DEPTH) return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, found, depth + 1);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  // Two shapes in the wild: `command: "npx"` with a separate `args`, and OpenCode's
  // `command: ["npx", "-y", …]` where the whole argv is the one field.
  const argv = commandArgv(record);
  if (argv.length > 0) found.push(`runs: ${formatCommandPreview(argv)}`);
  else if (typeof record.url === "string" && record.url.length > 0) {
    // A remote MCP server runs no local process, but it is the same trust decision: on its next
    // launch the agent connects to that endpoint, every tool the endpoint advertises becomes
    // callable, and a source-supplied `headers` entry can carry the credential it authenticates
    // with. Only reported where no command was found, so a local server reads as the spawn it is.
    found.push(`connects to ${formatCommandPreview([record.url])}`);
  }
  for (const key of EXEC_STRING_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      found.push(`runs ${formatCommandPreview([key])}: ${formatCommandPreview([value])}`);
    }
  }
  for (const value of Object.values(record)) walk(value, found, depth + 1);
}

function commandArgv(record: Record<string, unknown>): string[] {
  const command = record.command;
  if (Array.isArray(command)) return command.filter((token): token is string => typeof token === "string");
  if (typeof command !== "string" || command.length === 0) return [];
  const args = Array.isArray(record.args) ? record.args.filter((arg): arg is string => typeof arg === "string") : [];
  return [command, ...args];
}

/**
 * Fallback for a format this module cannot parse. Not anchored to the start of a line: a minified
 * one-line document has no line structure to anchor to, which is all it took to defeat the previous
 * version. Matches a `command` key wherever a key can legally begin.
 */
function textScanCommands(contents: string): string[] {
  const found: string[] = [];
  const pattern = /(?:^|[,{[\s])"?command"?\s*[:=]\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^,}\]\n]+)/gimu;
  for (const match of contents.matchAll(pattern)) {
    const value = unquote(match[1]!.trim());
    if (value.length > 0) found.push(`runs: ${formatCommandPreview([value])}`);
  }
  return found;
}

function unquote(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" ? parsed : value;
  } catch {
    return value;
  }
}

/**
 * Trees the writer copies or merges through untouched: `raw/`, skill directories, doc directories.
 * These never pass a generator, so nothing above sees them.
 *
 * A file is named when the destination itself makes it run - a platform's own config file (matched
 * case-insensitively, since `Settings.json` is `settings.json` on macOS and Windows), a directory a
 * platform auto-loads, an executable extension - or when its contents declare a command. That is
 * deliberately four overlapping rules rather than one list of filenames: the previous version
 * matched basenames only, and `raw/opencode/plugin/pwn.js` walked straight past it.
 */
function copiedTreePreviews(result: GenerationResult, platform: Platform): string[] {
  const previews: string[] = [];
  const trees = [
    ...result.post.rawDirs.map((dir) => ({ dir, destRelative: "" })),
    ...(result.post.copyDirs ?? []).map((copy) => ({ dir: copy.src, destRelative: copy.destRelative })),
    ...result.post.skillDirs.map((skill) => ({
      dir: skill.dir,
      destRelative: join(result.post.skillsDestRelative ?? "skills", skill.name),
    })),
  ];

  for (const tree of trees) {
    for (const relative of walkFiles(tree.dir)) {
      const destination = tree.destRelative ? join(tree.destRelative, relative) : relative;
      const scan = commandsIn(readTextFile(join(tree.dir, relative)), relative);
      const runsByWhereItLands = runsByDestination(destination);
      if (scan.findings.length === 0 && !runsByWhereItLands) continue;
      // A file that lands somewhere it will be executed, and that this module could not open - too
      // large, or a format it does not parse - must not print identically to one it read and found
      // nothing in. Saying so is the difference between "clean" and "unexamined".
      const caveat = runsByWhereItLands && !scan.readable ? " (contents not readable by the preview)" : "";
      previews.push(`installs ${formatCommandPreview([`${platform}/${destination}`])}${caveat}`);
      for (const finding of scan.findings) previews.push(runsLine(platform, destination, finding));
    }
  }
  return previews;
}

function runsByDestination(destination: string): boolean {
  const segments = destination.split(/[/\\]/u);
  const name = (segments.at(-1) ?? "").toLowerCase();
  return (
    NATIVE_CONFIG_BASENAMES.has(name) ||
    CODE_EXTENSIONS.has(extname(name)) ||
    segments.slice(0, -1).some((segment) => AUTOLOADED_DIRS.has(segment.toLowerCase()))
  );
}

function runsLine(platform: Platform, destination: string, finding: string): string {
  return `${formatCommandPreview([`${platform}/${destination}`])} ${sanitizeLogText(finding)}`;
}

/**
 * The approval settings a source ships. Not execution itself - which is why they are labelled
 * neutrally rather than as a warning - but they decide what the agent may do without asking, and a
 * source that turns approvals off has disarmed every prompt downstream of this one. Every leaf is
 * listed, tightening included: judging which direction a setting moves is how a preview starts
 * lying.
 */
function approvalSettingPreviews(permissions: PermissionsConfig | undefined): string[] {
  if (!permissions) return [];
  const previews: string[] = [];
  const visit = (node: unknown, path: readonly string[]): void => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      if (node.length > 0) previews.push(settingLine(path, node.map(String).join(", ")));
      return;
    }
    if (typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) visit(value, [...path, key]);
      return;
    }
    previews.push(settingLine(path, String(node)));
  };
  visit(permissions, []);
  return previews;
}

function settingLine(path: readonly string[], value: string): string {
  return `sets approval policy ${formatCommandPreview([path.join(".")])} = ${formatCommandPreview([value])}`;
}

function walkFiles(dir: string, prefix = ""): string[] {
  let entries: string[];
  try {
    // Sorted: this list is compared against one a caller already showed the user, and a directory
    // order that differed between the two scans would abort a legitimate install.
    entries = readdirSync(dir).sort();
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    // `statSync`, not `lstat`: `mergeOrCopyDir` and `cpSync` follow a symlinked directory, and a
    // preview that walked only real directories would list fewer files than the install writes.
    const stats = statSync(full, { throwIfNoEntry: false });
    if (stats?.isDirectory()) return walkFiles(full, `${prefix}${entry}/`);
    return stats ? [`${prefix}${entry}`] : [];
  });
}

function readTextFile(path: string): string | undefined {
  try {
    if ((statSync(path, { throwIfNoEntry: false })?.size ?? Infinity) > MAX_SCANNED_BYTES) return undefined;
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Render argv for the trust prompt so the preview cannot lie about what will run: control
 * characters (a CR or an ANSI sequence in a remote manifest could erase or forge lines) are escaped,
 * arguments holding whitespace or quotes are quoted so argument boundaries stay visible, and any
 * credential in a package URL is redacted.
 */
export function formatCommandPreview(argv: readonly string[]): string {
  return argv
    .map((token) => {
      const safe = sanitizeLogText(token);
      // Quote anything whose boundaries would otherwise be ambiguous: an empty token would
      // vanish entirely, and a trailing backslash would read as escaping the next separator.
      return safe === "" || /["'\s\\]/u.test(safe) ? JSON.stringify(safe) : safe;
    })
    .join(" ");
}

export const __test = { runsLine };
