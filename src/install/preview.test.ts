import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { analyzeProject, type Logger } from "../build.js";
import { generate } from "../generators/index.js";
import { PLATFORMS } from "../platforms.js";
import { previewInstalledExecution } from "./preview.js";

const silent: Logger = {
  info: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
  dim: () => {},
  header: () => {},
};
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sourceWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-preview-"));
  roots.push(root);
  const dir = join(root, ".ulis");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.yaml"), "version: 1\nname: preview\n");
  for (const [path, contents] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return dir;
}

/**
 * An independent, deliberately dumb scan of the generated text. It shares no code with the preview:
 * the preview parses each artifact and walks the object graph, this one just greps every line for a
 * `command` assignment. Agreement between two unrelated readings of the same bytes is the property
 * under test - if a generator ever emits a command in a shape the structured walk does not
 * recognise, this catches it, which is precisely the failure mode that produced four rounds of
 * bypasses.
 */
function commandsInGeneratedText(sourceDir: string): string[] {
  const project = analyzeProject({ sourceDir, logger: silent }).project;
  const found: string[] = [];
  for (const platform of PLATFORMS) {
    for (const artifact of generate(platform, project)?.artifacts ?? []) {
      const text = typeof artifact.contents === "string" ? artifact.contents : artifact.contents.toString("utf8");
      for (const line of text.split(/\r?\n/u)) {
        const match = /^[\s\-]*"?command"?\s*[:=]\s*(.+?),?\s*$/iu.exec(line);
        const value = match?.[1]?.replace(/^["']|["']$/gu, "");
        // A bare `[` opens OpenCode's array form; its argv is asserted by name in the next test.
        if (value && value !== "[" && value !== "{") found.push(value);
      }
    }
  }
  return found;
}

describe("previewInstalledExecution", () => {
  // Every payload class found across four review rounds, in one source.
  const payloadSource = () =>
    sourceWith({
      "agents/evil.md": [
        "---",
        "description: Looks harmless",
        "tools:",
        "  read: true",
        "hooks:",
        "  Stop:",
        '    - command: "declared-hook"',
        "security:",
        "  blockedCommands:",
        "    - rm -rf",
        "---",
        "",
        "Body.",
        "",
      ].join("\n"),
      "mcp.yaml": ["servers:", "  local:", '    type: "local"', '    command: "spawned-server"', ""].join("\n"),
      "raw/claude/agents/pwn.md": [
        "---",
        "description: raw",
        "hooks:",
        "  SessionStart:",
        '    - command: "raw-hook"',
        "---",
        "",
      ].join("\n"),
      "raw/opencode/plugin/pwn.js": "export default () => {};\n",
    });

  it("names every command that appears in the generated output", () => {
    const sourceDir = payloadSource();
    const preview = previewInstalledExecution({ sourceDir, presets: [], platforms: [...PLATFORMS] }).join("\n");

    const commands = commandsInGeneratedText(sourceDir);
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      // The preview escapes for display, so compare on the distinctive part rather than verbatim.
      expect(preview).toContain(command.split(/\s/u)[0]!.replace(/^"/u, ""));
    }
  });

  it("covers each payload class: declared hook, derived hook, MCP spawn, raw content, raw location", () => {
    const preview = previewInstalledExecution({
      sourceDir: payloadSource(),
      presets: [],
      platforms: [...PLATFORMS],
    }).join("\n");

    expect(preview).toContain("declared-hook");
    expect(preview).toContain("Blocked by ULIS security policy");
    // Once per shape: a string `command` (claude/codex/cursor/forge) and OpenCode's argv array,
    // which an earlier version of the walk skipped entirely.
    expect(preview).toContain("spawned-server");
    expect(preview).toContain("opencode/opencode.json runs: spawned-server");
    expect(preview).toContain("raw-hook");
    expect(preview).toContain("opencode/plugin/pwn.js");
  });

  it("says nothing about a source that installs nothing executable", () => {
    const sourceDir = sourceWith({
      "agents/plain.md": ["---", "description: Plain", "tools:", "  read: true", "---", "", "Body.", ""].join("\n"),
      "rules/style.md": ["---", "description: Style", "---", "", "Prose.", ""].join("\n"),
    });

    expect(previewInstalledExecution({ sourceDir, presets: [], platforms: [...PLATFORMS] })).toEqual([]);
  });

  /**
   * The text scan is the only thing standing behind a format this module has no parser for, and
   * mutating it away used to leave the suite green. A minified one-line document is the shape that
   * defeated the earlier line-anchored version.
   */
  it("falls back to scanning text when a format has no parser", () => {
    const sourceDir = sourceWith({
      "raw/claude/hooks/handler": '{"hooks":{"SessionStart":[{"command":"text-scanned-command"}]}}',
      "raw/claude/settings.json":
        '// JSONC a parser rejects\n{"hooks":{"SessionStart":[{"command":"minified-command"}]}}',
    });

    const preview = previewInstalledExecution({ sourceDir, presets: [], platforms: ["claude"] }).join("\n");
    expect(preview).toContain("text-scanned-command");
    expect(preview).toContain("minified-command");
  });

  /**
   * `CODE_EXTENSIONS` and `AUTOLOADED_DIRS` covered each other while the only test used
   * `plugin/pwn.js`, which satisfies both - deleting either rule left the suite green. One file
   * exercises each rule alone.
   */
  it("lists an executable file outside an auto-loaded directory, and an extensionless file inside one", () => {
    const sourceDir = sourceWith({
      "raw/claude/tools/helper.js": "module.exports = () => {};\n",
      "raw/claude/hooks/on-start": "#!/bin/sh\n",
    });

    const preview = previewInstalledExecution({ sourceDir, presets: [], platforms: ["claude"] }).join("\n");
    // Executable by extension, nowhere near an auto-loaded directory.
    expect(preview).toContain("claude/tools/helper.js");
    // Executable by location, with no extension to go on.
    expect(preview).toContain("claude/hooks/on-start");
  });

  // Attacker-controlled data must not end the run with a stack overflow from somewhere unrelated.
  it("survives a pathologically nested raw config", () => {
    const depth = 40_000;
    const sourceDir = sourceWith({
      "raw/claude/settings.json": `${'{"a":'.repeat(depth)}1${"}".repeat(depth)}`,
    });

    expect(() => previewInstalledExecution({ sourceDir, presets: [], platforms: ["claude"] })).not.toThrow();
  });

  it("is deterministic, because the caller compares it against a list already shown", () => {
    const sourceDir = payloadSource();
    const inputs = { sourceDir, presets: [], platforms: [...PLATFORMS] };
    expect(previewInstalledExecution(inputs)).toEqual(previewInstalledExecution(inputs));
  });
});
