import { afterEach, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { runInstall } from "./install.js";
import { cleanupInstallTempRoots, createTempRoot, read, silentLogger, write } from "./test-utils/install.js";
import { readMergeableConfig } from "./utils/config-merge.js";

afterEach(cleanupInstallTempRoots);

for (const prune of [true, false]) {
  it(`Claude global raw fragment: project MCP ownership with prune=${prune}`, async () => {
    const root = createTempRoot();
    const options = {
      sourceDir: join(root, "source"),
      destBase: join(root, "home"),
      userHome: join(root, "home"),
      platforms: ["claude"] as const,
      rebuild: true,
      logger: silentLogger,
      installSkills: false,
      installExtensions: false,
    };
    write(join(options.sourceDir, "config.yaml"), "version: 1\nname: test\n");
    const project = join(root, "project");
    const otherProject = join(root, "other-project");
    const fragment = join(options.sourceDir, "raw", "claude", ".claude.json");
    const target = join(options.userHome, ".claude.json");
    const manifest = join(options.userHome, ".claude", ".ulis-manifest.json");
    write(
      target,
      JSON.stringify({
        mcpServers: { managed: { command: "top-level-user-server" } },
        projects: {
          [project]: { mcpServers: { user: { command: "user-server" } }, trusted: true },
          [otherProject]: { mcpServers: { managed: { command: "other-server" } } },
        },
      }),
    );
    write(fragment, JSON.stringify({ projects: { [project]: { mcpServers: { managed: { command: "server" } } } } }));
    await runInstall(options);
    expect(JSON.parse(read(manifest)).mcpProjectServers).toEqual([[project, "managed"]]);
    write(
      fragment,
      JSON.stringify({ projects: { [project]: { mcpServers: { added: { command: "added-server" } } } } }),
    );
    const collision = join(options.sourceDir, "raw", "claude", "collision");
    write(collision, "generated");
    write(join(options.userHome, ".claude", "collision", "user-file"), "unmanaged");
    await expect(runInstall(options)).rejects.toThrow();
    expect(JSON.parse(read(manifest)).mcpProjectServers).toEqual([
      [project, "added"],
      [project, "managed"],
    ]);
    expect((readMergeableConfig(target) as any).projects[project].mcpServers).toEqual({
      added: { command: "added-server" },
      managed: { command: "server" },
      user: { command: "user-server" },
    });
    rmSync(collision);
    rmSync(fragment);
    await runInstall({ ...options, prune });
    await runInstall(options);
    const config = readMergeableConfig(target) as any;
    expect(config.projects[project]).toEqual({
      trusted: true,
      mcpServers: {
        user: { command: "user-server" },
        ...(prune ? {} : { managed: { command: "server" }, added: { command: "added-server" } }),
      },
    });
    expect(config.mcpServers).toEqual({ managed: { command: "top-level-user-server" } });
    expect(config.projects[otherProject].mcpServers).toEqual({ managed: { command: "other-server" } });
    expect(JSON.parse(read(manifest)).mcpProjectServers).toEqual([]);
  });
}

for (const invalid of ["bad", [["project"]], [["project", 42]], [["project", "server", "extra"]]]) {
  it(`rejects malformed project MCP ownership before writing: ${JSON.stringify(invalid)}`, async () => {
    const root = createTempRoot();
    const sourceDir = join(root, "source");
    const userHome = join(root, "home");
    write(join(sourceDir, "config.yaml"), "version: 1\nname: test\n");
    const target = join(userHome, ".claude.json");
    write(target, '{"mcpServers":{"user":{"command":"user-server"}}}');
    const before = read(target);
    write(
      join(userHome, ".claude", ".ulis-manifest.json"),
      JSON.stringify({
        version: 3,
        agents: [],
        skills: [],
        rootEntries: [],
        mcpProjectServers: invalid,
      }),
    );
    await expect(
      runInstall({ sourceDir, destBase: userHome, userHome, platforms: ["claude"], logger: silentLogger }),
    ).rejects.toThrow("expected project/server pairs");
    expect(read(target)).toBe(before);
  });
}
