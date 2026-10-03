import { afterEach, expect, it, spyOn } from "bun:test";
import { join } from "node:path";

import { buildCursorConfigArtifacts } from "./generators/platforms/cursor/config.js";
import type { ProjectBundle } from "./generators/types.js";
import { runInstall } from "./install.js";
import * as installFs from "./install/fs.js";
import { preflightOwnership, reconcileOwnership } from "./install/manifest.js";
import { installCursor } from "./install/platforms.js";
import type { InstallContext } from "./install/types.js";
import { PLATFORMS, platformConfigDir } from "./platforms.js";
import { cleanupInstallTempRoots, createTempRoot, read, silentLogger, write } from "./test-utils/install.js";
import { readMergeableConfig } from "./utils/config-merge.js";
import { getPreservedNativeConfigEntries } from "./utils/preserved-native-configs.js";

afterEach(cleanupInstallTempRoots);

for (const platform of PLATFORMS) {
  for (const global of [false, true]) {
    it(`${platform} ${global ? "global" : "project"}: prunes removed managed MCP and preserves unmanaged servers`, async () => {
      const root = createTempRoot();
      const sourceDir = join(root, "source");
      const userHome = join(root, "home");
      const destBase = global ? userHome : join(root, "project");
      const outputDir = join(sourceDir, "generated");
      write(join(sourceDir, "config.yaml"), "version: 1\nname: test\n");
      write(join(sourceDir, "mcp.yaml"), "servers:\n  managed:\n    type: local\n    command: server\n");
      const options = {
        rebuild: true,
        sourceDir,
        outputDir,
        destBase,
        userHome,
        platforms: [platform],
        logger: silentLogger,
        installSkills: false,
        installExtensions: false,
      };
      await runInstall(options);
      const entry = getPreservedNativeConfigEntries(platform, { outputDir, destBase, userHome }).find((entry) =>
        entry.preservedPaths.some(([key]) => ["mcp", "mcpServers", "mcp_servers"].includes(key!)),
      )!;
      const key = platform === "opencode" ? "mcp" : platform === "codex" ? "mcp_servers" : "mcpServers";
      if (platform === "codex") {
        write(entry.targetPath, read(entry.targetPath) + '\n[mcp_servers.user]\ncommand = "user-server"\n');
      } else {
        const config = readMergeableConfig(entry.targetPath) as Record<string, any>;
        config[key].user = { command: "user-server" };
        write(entry.targetPath, JSON.stringify(config));
      }
      write(join(sourceDir, "mcp.yaml"), "servers: {}\n");
      await runInstall(options);
      const config = readMergeableConfig(entry.targetPath) as Record<string, any>;
      expect(config[key]).not.toHaveProperty("managed");
      expect(config[key].user.command).toBe("user-server");
      const manifest = JSON.parse(read(join(platformConfigDir(platform, destBase, userHome), ".ulis-manifest.json")));
      expect(manifest.mcpServers).toEqual([]);
    });
  }
}

it("Cursor disabling removes a managed MCP server; no-prune retains and releases removed servers", async () => {
  const root = createTempRoot();
  const sourceDir = join(root, "source");
  const destBase = join(root, "project");
  const userHome = join(root, "home");
  write(join(sourceDir, "config.yaml"), "version: 1\nname: test\n");
  const mcp = join(sourceDir, "mcp.yaml");
  const options = {
    rebuild: true,
    sourceDir,
    destBase,
    userHome,
    platforms: ["cursor"] as const,
    logger: silentLogger,
    installSkills: false,
    installExtensions: false,
  };
  write(mcp, "servers:\n  managed:\n    type: local\n    command: server\n");
  await runInstall(options);
  write(mcp, "servers:\n  managed:\n    type: local\n    command: server\n    enabled: false\n");
  await runInstall(options);
  const target = join(destBase, ".cursor", "mcp.json");
  expect(readMergeableConfig(target)).toEqual({ mcpServers: {} });
  write(mcp, "servers:\n  managed:\n    type: local\n    command: server\n");
  await runInstall(options);
  write(mcp, "servers: {}\n");
  await runInstall({ ...options, prune: false });
  await runInstall(options);
  expect(readMergeableConfig(target)).toEqual({ mcpServers: { managed: { command: "server" } } });
});

it("installCursor removes a disabled managed server without dropping a user's MCP server", async () => {
  const root = createTempRoot();
  const context = {
    outputDir: join(root, "generated"),
    destBase: join(root, "project"),
    userHome: join(root, "home"),
    prune: true,
    backup: false,
  } as InstallContext;
  const generated = join(context.outputDir, "cursor", "mcp.json");
  write(generated, JSON.stringify({ mcpServers: { managed: { command: "server" } } }));
  await installCursor(context);
  reconcileOwnership(
    "cursor",
    preflightOwnership(["cursor"], context.outputDir, context.destBase, context.userHome, true).get("cursor")!,
    true,
  );
  const target = join(context.destBase, ".cursor", "mcp.json");
  write(target, JSON.stringify({ mcpServers: { managed: { command: "server" }, user: { command: "user-server" } } }));
  const project = {
    mcp: { servers: { managed: { type: "local", command: "server", enabled: false } } },
  } as unknown as ProjectBundle;
  write(generated, String(buildCursorConfigArtifacts(project)[0]!.contents));
  await installCursor(context);
  expect(readMergeableConfig(target)).toEqual({ mcpServers: { user: { command: "user-server" } } });
});

it("records MCP ownership if a later copy fails, then prunes only the managed server", async () => {
  const root = createTempRoot();
  const sourceDir = join(root, "source");
  const outputDir = join(sourceDir, "generated");
  const destBase = join(root, "project");
  const userHome = join(root, "home");
  write(join(sourceDir, "config.yaml"), "version: 1\nname: test\n");
  write(join(outputDir, "cursor", "mcp.json"), JSON.stringify({ mcpServers: { managed: { command: "server" } } }));
  const target = join(destBase, ".cursor", "mcp.json");
  write(target, JSON.stringify({ mcpServers: { user: { command: "user-server" } } }));
  const options = {
    sourceDir,
    destBase,
    userHome,
    platforms: ["cursor"] as const,
    logger: silentLogger,
    installSkills: false,
    installExtensions: false,
  };
  const copy = spyOn(installFs, "copyPlatformContents").mockImplementation(() => {
    throw new Error("copy failed");
  });
  try {
    await expect(runInstall(options)).rejects.toThrow("copy failed");
  } finally {
    copy.mockRestore();
  }
  expect(JSON.parse(read(join(destBase, ".cursor", ".ulis-manifest.json"))).mcpServers).toEqual(["managed"]);
  write(join(outputDir, "cursor", "mcp.json"), JSON.stringify({ mcpServers: {} }));
  await runInstall(options);
  expect(readMergeableConfig(target)).toEqual({ mcpServers: { user: { command: "user-server" } } });
});
