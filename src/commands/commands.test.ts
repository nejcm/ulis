import { afterEach, describe, expect, it } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildCmd } from "./build.js";
import { initCmd } from "./init.js";
import { installCmd } from "./install.js";

const fixturesDir = resolve(join(import.meta.dirname, "../../tests/fixtures"));
const originalCwd = process.cwd();
const tmpRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-cmd-"));
  tmpRoots.push(root);
  return root;
}

function copyFixtureSource(projectRoot: string, dirname = ".ulis"): string {
  const sourceDir = join(projectRoot, dirname);
  cpSync(fixturesDir, sourceDir, { recursive: true });
  return sourceDir;
}

afterEach(() => {
  process.chdir(originalCwd);
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("commands", () => {
  it("initCmd scaffolds a project-local source tree", async () => {
    const projectRoot = createTempRoot();
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "command-test" }));
    process.chdir(projectRoot);

    await initCmd();

    expect(existsSync(join(projectRoot, ".ulis", "config.yaml"))).toBe(true);
    expect(existsSync(join(projectRoot, ".ulis", "agents", ".gitkeep"))).toBe(true);
    expect(readFileSync(join(projectRoot, ".ulis", "config.yaml"), "utf8")).toContain("name: command-test");
    expect(readFileSync(join(projectRoot, ".gitignore"), "utf8")).toContain("/.ulis/generated/");
  });

  it("buildCmd writes selected generated output under the project source tree", async () => {
    const projectRoot = createTempRoot();
    copyFixtureSource(projectRoot);
    process.chdir(projectRoot);

    await buildCmd({ target: "claude" });

    expect(existsSync(join(projectRoot, ".ulis", "generated", "claude", "agents", "worker.md"))).toBe(true);
    expect(existsSync(join(projectRoot, ".ulis", "generated", "opencode"))).toBe(false);
  });

  it("buildCmd honors explicit --source over project-local source", async () => {
    const projectRoot = createTempRoot();
    copyFixtureSource(projectRoot, "custom-source");
    process.chdir(projectRoot);

    await buildCmd({ source: "custom-source", target: "cursor" });

    expect(existsSync(join(projectRoot, "custom-source", "generated", "cursor", "agents", "worker.mdc"))).toBe(true);
    expect(existsSync(join(projectRoot, ".ulis", "generated"))).toBe(false);
  });

  it("installCmd installs generated config into the project platform directory", async () => {
    const projectRoot = createTempRoot();
    copyFixtureSource(projectRoot);
    process.chdir(projectRoot);

    await installCmd({ yes: true, target: "claude" });

    expect(existsSync(join(projectRoot, ".claude", "agents", "worker.md"))).toBe(true);
    expect(existsSync(join(projectRoot, ".claude.json"))).toBe(true);
    expect(readFileSync(join(projectRoot, ".claude", "agents", "worker.md"), "utf8")).toContain("A minimal test agent");
  });

  it("installCmd with --yes fails fast for missing presets without prompting", async () => {
    const projectRoot = createTempRoot();
    copyFixtureSource(projectRoot);
    process.chdir(projectRoot);

    const missingPreset = `missing-${Date.now()}`;
    await expect(installCmd({ yes: true, target: "claude", preset: missingPreset })).rejects.toThrow(
      `Preset "${missingPreset}" not found`,
    );
  });
});
