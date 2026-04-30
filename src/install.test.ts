import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Logger } from "./build.js";
import { runInstall } from "./install.js";

const tmpRoots: string[] = [];

const silentLogger: Logger = {
  info() {},
  success() {},
  warn() {},
  error() {},
  dim() {},
  header() {},
};

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-install-"));
  tmpRoots.push(root);
  return root;
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

function createForgecodeOutput(outputDir: string): void {
  write(join(outputDir, "forgecode", "AGENTS.md"), "Forge global instructions.\n");
  write(join(outputDir, "forgecode", ".forge", ".mcp.json"), JSON.stringify({ mcpServers: {} }, null, 2));
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("runInstall", () => {
  it("installs ForgeCode AGENTS.md into the Forge home directory for global installs", () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    createForgecodeOutput(outputDir);

    runInstall({
      sourceDir,
      outputDir,
      destBase: userHome,
      userHome,
      platforms: ["forgecode"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(read(join(userHome, ".forge", "AGENTS.md"))).toBe("Forge global instructions.\n");
    expect(existsSync(join(userHome, "AGENTS.md"))).toBe(false);
  });

  it("installs ForgeCode AGENTS.md into the Forge project config directory for project installs", () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });
    createForgecodeOutput(outputDir);

    runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["forgecode"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(read(join(projectDir, ".forge", "AGENTS.md"))).toBe("Forge global instructions.\n");
    expect(existsSync(join(projectDir, "AGENTS.md"))).toBe(false);
  });
});
