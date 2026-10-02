import { afterEach, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { runInstall } from "./install.js";
import { cleanupInstallTempRoots, createTempRoot, read, silentLogger, write } from "./test-utils/install.js";
import { readMergeableConfig } from "./utils/config-merge.js";

afterEach(cleanupInstallTempRoots);

it("failed Cursor copy keeps removed MCP servers and records only MCP servers actually written", async () => {
  const root = createTempRoot();
  const options = {
    sourceDir: join(root, "source"),
    outputDir: join(root, "generated"),
    destBase: join(root, "project"),
    userHome: join(root, "home"),
    platforms: ["cursor"] as const,
    logger: silentLogger,
    installSkills: false,
    installExtensions: false,
  };
  write(join(options.sourceDir, "config.yaml"), "version: 1\nname: test\n");
  const generated = join(options.outputDir, "cursor", "mcp.json");
  const targetDir = join(options.destBase, ".cursor");
  const target = join(targetDir, "mcp.json");
  const manifest = join(targetDir, ".ulis-manifest.json");
  write(generated, '{"mcpServers":{"old":{"command":"old-server"}}}');
  await runInstall(options);
  write(target, '{"mcpServers":{"old":{"command":"old-server"},"user":{"command":"user-server"}}}');
  write(generated, '{"mcpServers":{"new":{"command":"new-server"}}}');
  write(join(options.outputDir, "cursor", "collision"), "generated");
  write(join(targetDir, "collision", "user-file"), "unmanaged");
  await expect(runInstall(options)).rejects.toThrow();
  expect((readMergeableConfig(target) as any).mcpServers).toEqual({
    old: { command: "old-server" },
    new: { command: "new-server" },
    user: { command: "user-server" },
  });
  expect(JSON.parse(read(manifest)).mcpServers).toEqual(["new", "old"]);
  expect(read(join(targetDir, "collision", "user-file"))).toBe("unmanaged");

  rmSync(target);
  write(join(target, "user-file"), "unmanaged");
  write(generated, '{"mcpServers":{"unwritten":{"command":"server"}}}');
  await expect(runInstall(options)).rejects.toThrow();
  expect(JSON.parse(read(manifest)).mcpServers).toEqual(["new", "old"]);
  expect(read(join(target, "user-file"))).toBe("unmanaged");

  rmSync(target, { recursive: true });
  write(
    target,
    '{"mcpServers":{"old":{"command":"old-server"},"new":{"command":"new-server"},"user":{"command":"user-server"}}}',
  );
  rmSync(join(options.outputDir, "cursor", "collision"));
  write(generated, '{"mcpServers":{}}');
  await runInstall(options);
  expect((readMergeableConfig(target) as any).mcpServers).toEqual({ user: { command: "user-server" } });
  expect(read(join(targetDir, "collision", "user-file"))).toBe("unmanaged");
});
