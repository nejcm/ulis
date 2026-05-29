import { describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { platformConfigDir } from "../platforms.js";
import { createTempRoot, writeTextFile } from "../test-utils/fs.js";
import { detectInstallCollisions } from "./platforms.js";

function write(path: string, content = ""): void {
  writeTextFile(path, content);
}

describe("detectInstallCollisions", () => {
  it("detects Claude project MCP config", () => {
    const root = createTempRoot("ulis-install-collisions-");
    write(join(root, ".mcp.json"), "{}");

    expect(detectInstallCollisions(root, ["claude"], false)).toEqual([join(root, ".mcp.json")]);
  });

  it("detects Claude global config", () => {
    const root = createTempRoot("ulis-install-collisions-");
    write(join(root, ".claude.json"), "{}");

    expect(detectInstallCollisions(root, ["claude"], true)).toEqual([join(root, ".claude.json")]);
  });

  it("detects ForgeCode directory and MCP config", () => {
    const root = createTempRoot("ulis-install-collisions-");
    write(join(root, ".forge", ".mcp.json"), "{}");

    expect(detectInstallCollisions(root, ["forgecode"], false)).toEqual([
      join(root, ".forge"),
      join(root, ".forge", ".mcp.json"),
    ]);
  });

  it("ignores empty platform directories", () => {
    const root = createTempRoot("ulis-install-collisions-");
    mkdirSync(join(root, ".claude"), { recursive: true });
    mkdirSync(join(root, ".codex"), { recursive: true });
    mkdirSync(join(root, ".cursor"), { recursive: true });
    mkdirSync(join(root, ".forge"), { recursive: true });
    mkdirSync(join(root, ".opencode"), { recursive: true });

    expect(detectInstallCollisions(root, ["claude", "codex", "cursor", "forgecode", "opencode"], false)).toEqual([]);
  });

  it("uses the same home directory layout as installers when destBase is userHome", () => {
    const root = createTempRoot("ulis-install-collisions-");
    const opencodeHomeDir = platformConfigDir("opencode", root, root);
    write(join(opencodeHomeDir, "opencode.json"), "{}");

    expect(detectInstallCollisions(root, ["opencode"], false, root)).toEqual([opencodeHomeDir]);
  });

  it("does not return duplicate paths", () => {
    const root = createTempRoot("ulis-install-collisions-");
    write(join(root, ".mcp.json"), "{}");

    expect(detectInstallCollisions(root, ["claude", "claude"], false)).toEqual([join(root, ".mcp.json")]);
  });
});
