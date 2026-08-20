import { describe, expect, it, spyOn } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { PLATFORMS, platformConfigDir, type Platform } from "../platforms.js";
import { createTempRoot, writeTextFile } from "../test-utils/fs.js";
import * as installFs from "./fs.js";
import {
  detectInstallCollisions,
  installClaude,
  installCodex,
  installCursor,
  installForgecode,
  installOpencode,
} from "./platforms.js";
import type { InstallContext } from "./types.js";

function write(path: string, content = ""): void {
  writeTextFile(path, content);
}

describe("detectInstallCollisions", () => {
  it("detects Claude project MCP config", () => {
    const root = createTempRoot("ulis-install-collisions-");
    write(join(root, ".mcp.json"), "{}");

    expect(detectInstallCollisions(root, ["claude"])).toEqual([join(root, ".mcp.json")]);
  });

  it("detects Claude global config", () => {
    const root = createTempRoot("ulis-install-collisions-");
    write(join(root, ".claude.json"), "{}");

    expect(detectInstallCollisions(root, ["claude"], root)).toEqual([join(root, ".claude.json")]);
  });

  it("detects ForgeCode directory and MCP config", () => {
    const root = createTempRoot("ulis-install-collisions-");
    write(join(root, ".forge", ".mcp.json"), "{}");

    expect(detectInstallCollisions(root, ["forgecode"])).toEqual([
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

    expect(detectInstallCollisions(root, ["claude", "codex", "cursor", "forgecode", "opencode"])).toEqual([]);
  });

  it("uses the same home directory layout as installers when destBase is userHome", () => {
    const root = createTempRoot("ulis-install-collisions-");
    const opencodeHomeDir = platformConfigDir("opencode", root, root);
    write(join(opencodeHomeDir, "opencode.json"), "{}");

    expect(detectInstallCollisions(root, ["opencode"], root)).toEqual([opencodeHomeDir]);
  });

  it("does not return duplicate paths", () => {
    const root = createTempRoot("ulis-install-collisions-");
    write(join(root, ".mcp.json"), "{}");

    expect(detectInstallCollisions(root, ["claude", "claude"])).toEqual([join(root, ".mcp.json")]);
  });
});

describe("platform install skip names", () => {
  it("passes every reserved native config filename to copyPlatformContents", async () => {
    const expected: Record<Platform, readonly string[]> = {
      opencode: [".ulis-manifest.json", ".ulis-provenance.json", "opencode.json"],
      claude: [
        ".ulis-manifest.json",
        ".ulis-provenance.json",
        "settings.json",
        "settings.local.json",
        ".claude.json",
        ".mcp.json",
      ],
      codex: [".ulis-manifest.json", ".ulis-provenance.json", "config.toml"],
      cursor: [".ulis-manifest.json", ".ulis-provenance.json", "mcp.json"],
      forgecode: [".ulis-manifest.json", ".ulis-provenance.json", ".mcp.json", ".forge.toml"],
    };
    const installers = {
      opencode: installOpencode,
      claude: installClaude,
      codex: installCodex,
      cursor: installCursor,
      forgecode: installForgecode,
    } satisfies Record<Platform, (context: InstallContext) => Promise<void>>;
    const copySpy = spyOn(installFs, "copyPlatformContents").mockImplementation(() => {});

    try {
      for (const platform of PLATFORMS) {
        copySpy.mockClear();
        const root = createTempRoot("ulis-install-skip-names-");
        await installers[platform]({
          outputDir: join(root, "generated"),
          destBase: join(root, "project"),
          userHome: join(root, "home"),
          globalInstall: false,
          backup: false,
          prune: true,
          timestamp: "test",
          extensions: {},
          runner: "bunx",
          installExtensionsEnabled: false,
        });

        expect(copySpy).toHaveBeenCalled();
        for (const [, , options] of copySpy.mock.calls) {
          for (const filename of expected[platform]) {
            expect(options?.skipNames?.has(filename)).toBe(true);
          }
        }
      }
    } finally {
      copySpy.mockRestore();
    }
  });
});
