import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { __test, runInstall } from "./install.js";
import { detectInstallCollisions } from "./install/platforms.js";
import { cleanupInstallTempRoots, createTempRoot, read, silentLogger, write } from "./test-utils/install.js";

afterEach(() => {
  __test.resetRuntimeDependencies();
  cleanupInstallTempRoots();
});

// runInstall: MCP server config merge across Claude project and global installs.
describe("runInstall", () => {
  it("writes Claude MCP servers to <project>/.mcp.json on a project install", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });

    write(join(outputDir, "claude", "settings.json"), "{}");
    write(
      join(outputDir, "claude", ".claude.json"),
      JSON.stringify({ mcpServers: { shared: { command: "generated" } } }, null, 2),
    );

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["claude"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(existsSync(join(projectDir, ".mcp.json"))).toBe(true);
    expect(existsSync(join(projectDir, ".claude.json"))).toBe(false);
    expect(JSON.parse(read(join(projectDir, ".mcp.json")))).toEqual({
      mcpServers: { shared: { command: "generated" } },
    });
  });

  it("writes Claude MCP servers to <home>/.claude.json on a global install", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });

    write(join(outputDir, "claude", "settings.json"), "{}");
    write(
      join(outputDir, "claude", ".claude.json"),
      JSON.stringify({ mcpServers: { shared: { command: "generated" } } }, null, 2),
    );

    await runInstall({
      sourceDir,
      outputDir,
      destBase: userHome,
      userHome,
      platforms: ["claude"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(existsSync(join(userHome, ".claude.json"))).toBe(true);
    expect(existsSync(join(userHome, ".mcp.json"))).toBe(false);
    expect(JSON.parse(read(join(userHome, ".claude.json")))).toEqual({
      mcpServers: { shared: { command: "generated" } },
    });
  });

  it.each([
    ["home layout with explicit global scope", true, true],
    ["project layout with explicit global scope", true, false],
    ["home layout with inferred scope", undefined, true],
    ["project layout with inferred scope", undefined, false],
  ] as const)(
    "selects the Claude root config from destination layout for %s",
    async (_name, globalInstall, homeLayout) => {
      const root = createTempRoot();
      const sourceDir = join(root, ".ulis");
      const outputDir = join(sourceDir, "generated");
      const userHome = join(root, "home");
      const destBase = homeLayout ? userHome : join(root, "project");
      const targetConfig = join(destBase, homeLayout ? ".claude.json" : ".mcp.json");
      const otherConfig = join(destBase, homeLayout ? ".mcp.json" : ".claude.json");
      const original = JSON.stringify({ mcpServers: { existing: { command: "existing" } } });
      mkdirSync(userHome, { recursive: true });
      write(join(outputDir, "claude", "settings.json"), "{}");
      write(join(outputDir, "claude", ".claude.json"), JSON.stringify({ mcpServers: {} }));
      write(targetConfig, original);
      write(otherConfig, original);

      expect(detectInstallCollisions(destBase, ["claude"], userHome)).toEqual([targetConfig]);

      await runInstall({
        sourceDir,
        outputDir,
        destBase,
        userHome,
        globalInstall,
        platforms: ["claude"],
        rebuild: false,
        backup: true,
        installSkills: false,
        logger: silentLogger,
      });

      const backup = readdirSync(destBase).find(
        (entry) => entry.startsWith(`${homeLayout ? ".claude.json" : ".mcp.json"}.`) && entry.endsWith(".backup"),
      );
      expect(backup).toBeDefined();
      expect(read(join(destBase, backup!))).toBe(original);
      expect(
        readdirSync(destBase).some(
          (entry) => entry.startsWith(`${homeLayout ? ".mcp.json" : ".claude.json"}.`) && entry.endsWith(".backup"),
        ),
      ).toBe(false);
    },
  );

  it("overlays generated MCP servers into ~/.claude.json without removing unmanaged servers", async () => {
    // Regression: ULIS used to capture only the `mcpServers` slice of an
    // existing ~/.claude.json and write back just that slice, wiping every
    // other key (projects, enabledPlugins, theme, history, ...). Global Claude
    // installs must preserve user-owned keys and unmanaged MCP servers while
    // overwriting generated values at the same paths.
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });

    write(join(outputDir, "claude", "settings.json"), "{}");
    write(
      join(outputDir, "claude", ".claude.json"),
      JSON.stringify({ mcpServers: { shared: { command: "generated" } } }, null, 2),
    );
    write(
      join(userHome, ".claude.json"),
      JSON.stringify(
        {
          // Claude Code-owned state that MUST survive an install:
          theme: "dark",
          projects: { "/home/me/repo": { lastModified: "2026-05-15", history: ["msg1", "msg2"] } },
          enabledPlugins: { "marketplace@example": true },
          autoUpdatesChannel: "latest",
          telemetryStatus: "enabled",
          // Existing MCP servers are merged by name:
          mcpServers: { existing: { command: "old" }, shared: { command: "old" } },
        },
        null,
        2,
      ),
    );

    await runInstall({
      sourceDir,
      outputDir,
      destBase: userHome,
      userHome,
      platforms: ["claude"],
      rebuild: false,
      logger: silentLogger,
    });

    // Existing state and unmanaged MCP servers survive; generated conflicts win.
    expect(JSON.parse(read(join(userHome, ".claude.json")))).toEqual({
      theme: "dark",
      projects: { "/home/me/repo": { lastModified: "2026-05-15", history: ["msg1", "msg2"] } },
      enabledPlugins: { "marketplace@example": true },
      autoUpdatesChannel: "latest",
      telemetryStatus: "enabled",
      mcpServers: {
        existing: { command: "old" },
        shared: { command: "generated" },
      },
    });
  });

  it("keeps user-owned ~/.claude.json keys intact when no MCP servers are generated", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });

    write(join(outputDir, "claude", "settings.json"), "{}");
    // No generated .claude.json (empty mcp.yaml scenario).
    write(
      join(userHome, ".claude.json"),
      JSON.stringify(
        {
          theme: "dark",
          projects: { "/home/me/repo": { lastModified: "2026-05-15" } },
          mcpServers: { stale: { command: "old" } },
        },
        null,
        2,
      ),
    );

    await runInstall({
      sourceDir,
      outputDir,
      destBase: userHome,
      userHome,
      platforms: ["claude"],
      rebuild: false,
      logger: silentLogger,
    });

    // No generated file means the existing file is left unchanged.
    expect(JSON.parse(read(join(userHome, ".claude.json")))).toEqual({
      theme: "dark",
      projects: { "/home/me/repo": { lastModified: "2026-05-15" } },
      mcpServers: { stale: { command: "old" } },
    });
  });

  it("preserves an existing project .mcp.json and merges with generated mcpServers", async () => {
    const root = createTempRoot();
    const sourceDir = join(root, ".ulis");
    const outputDir = join(sourceDir, "generated");
    const projectDir = join(root, "project");
    const userHome = join(root, "home");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userHome, { recursive: true });

    write(join(outputDir, "claude", "settings.json"), "{}");
    write(
      join(outputDir, "claude", ".claude.json"),
      JSON.stringify({ mcpServers: { shared: { command: "generated" } } }, null, 2),
    );
    write(
      join(projectDir, ".mcp.json"),
      JSON.stringify({ mcpServers: { teamOnly: { command: "team" }, shared: { command: "old" } } }, null, 2),
    );

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome,
      platforms: ["claude"],
      rebuild: false,
      logger: silentLogger,
    });

    expect(JSON.parse(read(join(projectDir, ".mcp.json")))).toEqual({
      mcpServers: { teamOnly: { command: "team" }, shared: { command: "generated" } },
    });
  });
});
