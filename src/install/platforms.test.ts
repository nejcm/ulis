import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { platformConfigDir } from "../platforms.js";
import { detectInstallCollisions } from "./platforms.js";

const tmpRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-install-collisions-"));
  tmpRoots.push(root);
  return root;
}

function write(path: string, content = ""): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("detectInstallCollisions", () => {
  it("detects Claude project MCP config", () => {
    const root = createTempRoot();
    write(join(root, ".mcp.json"), "{}");

    expect(detectInstallCollisions(root, ["claude"], false)).toEqual([join(root, ".mcp.json")]);
  });

  it("detects Claude global config", () => {
    const root = createTempRoot();
    write(join(root, ".claude.json"), "{}");

    expect(detectInstallCollisions(root, ["claude"], true)).toEqual([join(root, ".claude.json")]);
  });

  it("detects ForgeCode directory and MCP config", () => {
    const root = createTempRoot();
    write(join(root, ".forge", ".mcp.json"), "{}");

    expect(detectInstallCollisions(root, ["forgecode"], false)).toEqual([
      join(root, ".forge"),
      join(root, ".forge", ".mcp.json"),
    ]);
  });

  it("ignores empty platform directories", () => {
    const root = createTempRoot();
    mkdirSync(join(root, ".claude"), { recursive: true });
    mkdirSync(join(root, ".codex"), { recursive: true });
    mkdirSync(join(root, ".cursor"), { recursive: true });
    mkdirSync(join(root, ".forge"), { recursive: true });
    mkdirSync(join(root, ".opencode"), { recursive: true });

    expect(detectInstallCollisions(root, ["claude", "codex", "cursor", "forgecode", "opencode"], false)).toEqual([]);
  });

  it("uses the same home directory layout as installers when destBase is userHome", () => {
    const root = createTempRoot();
    const opencodeHomeDir = platformConfigDir("opencode", root, root);
    write(join(opencodeHomeDir, "opencode.json"), "{}");

    expect(detectInstallCollisions(root, ["opencode"], false, root)).toEqual([opencodeHomeDir]);
  });

  it("does not return duplicate paths", () => {
    const root = createTempRoot();
    write(join(root, ".mcp.json"), "{}");

    expect(detectInstallCollisions(root, ["claude", "claude"], false)).toEqual([join(root, ".mcp.json")]);
  });
});
