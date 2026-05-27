import { afterEach, describe, expect, it } from "bun:test";
import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { analyzeProject } from "./build.js";

const fixturesDir = resolve(join(import.meta.dirname, "../tests/fixtures"));
const tmpRoots: string[] = [];
const silentLogger = {
  header: () => {},
  info: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
  dim: () => {},
};

function captureLogger() {
  const errors: string[] = [];
  return {
    header: () => {},
    info: () => {},
    success: () => {},
    warn: () => {},
    error: (message: string) => errors.push(message),
    dim: () => {},
    errors,
  };
}

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-build-"));
  tmpRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("analyzeProject", () => {
  it("validates a source tree without writing generated files", () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    cpSync(fixturesDir, sourceDir, { recursive: true });

    const analysis = analyzeProject({ sourceDir, logger: silentLogger });

    expect(analysis.errorCount).toBe(0);
    expect(analysis.project.agents.length).toBe(1);
    expect(existsSync(join(sourceDir, "generated"))).toBe(false);
  });

  it("throws on validation errors and still writes no generated output", () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    cpSync(fixturesDir, sourceDir, { recursive: true });

    const duplicateSkillDir = join(sourceDir, "skills", "duplicate-skill");
    mkdirSync(duplicateSkillDir, { recursive: true });
    writeFileSync(
      join(duplicateSkillDir, "SKILL.md"),
      `---
name: my-skill
description: A minimal test skill duplicate
custom_agent_hint: keep-me
allowImplicitInvocation: false
platforms:
  codex:
    model: gpt-5.4
---

Duplicate skill for test.`,
    );

    // This path intentionally exercises the failing analysis path; parse or validation
    // failures are both acceptable so long as no generated files are written.
    expect(() => analyzeProject({ sourceDir, logger: silentLogger })).toThrow("No files written.");
    expect(existsSync(join(sourceDir, "generated"))).toBe(false);
  });

  it("reports validation diagnostics against the original preset file", () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const presetDir = join(root, "preset");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(join(presetDir, "agents"), { recursive: true });
    writeFileSync(join(sourceDir, "config.yaml"), "version: 1\nname: base\n");
    writeFileSync(join(presetDir, "config.yaml"), "version: 1\nname: preset\n");
    writeFileSync(
      join(presetDir, "agents", "preset-agent.md"),
      `---
description: Preset agent
tools:
  read: true
mcpServers:
  - missing
---
Body.
`,
    );
    const logger = captureLogger();

    expect(() => analyzeProject({ sourceDir, logger, presets: [{ name: "team", dir: presetDir }] })).toThrow(
      "Validation failed",
    );

    expect(logger.errors.join("\n")).toContain("source: preset:team");
    expect(logger.errors.join("\n")).toContain("path: " + join(presetDir, "agents", "preset-agent.md"));
  });

  it("collects parse diagnostics across presets and base before failing", () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const presetDir = join(root, "preset");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(presetDir, { recursive: true });
    writeFileSync(join(sourceDir, "config.yaml"), "version: 1\nname: base\nrunner: nope\n");
    writeFileSync(join(presetDir, "config.yaml"), "version: 1\nname: preset\nunsupportedPlatformRules: nope\n");
    const logger = captureLogger();

    expect(() => analyzeProject({ sourceDir, logger, presets: [{ name: "team", dir: presetDir }] })).toThrow(
      "Parsing failed: 2 error(s). No files written.",
    );

    const errors = logger.errors.join("\n");
    expect(errors).toContain("source: preset:team");
    expect(errors).toContain("source: base");
  });
});
