import { afterEach, expect, it } from "bun:test";
import { join } from "node:path";

import { runInstall } from "./install.js";
import { platformConfigDir } from "./platforms.js";
import { cleanupInstallTempRoots, createTempRoot, read, silentLogger, write } from "./test-utils/install.js";
import { readMergeableConfig } from "./utils/config-merge.js";
import { getPreservedNativeConfigEntries } from "./utils/preserved-native-configs.js";

afterEach(cleanupInstallTempRoots);

for (const platform of ["cursor", "claude"] as const) {
  for (const name of ["constructor", "toString", "__proto__"]) {
    for (const prune of [true, false]) {
      it(`${platform}: own MCP key ${name} with prune=${prune}`, async () => {
        const root = createTempRoot();
        const options = {
          sourceDir: join(root, "source"),
          outputDir: join(root, "generated"),
          destBase: join(root, "home"),
          userHome: join(root, "home"),
          platforms: [platform],
          logger: silentLogger,
          installSkills: false,
          installExtensions: false,
        };
        write(join(options.sourceDir, "config.yaml"), "version: 1\nname: test\n");
        const entry = getPreservedNativeConfigEntries(platform, options).find((entry) => entry.mcpKey)!;
        write(entry.generatedPath, JSON.stringify({ mcpServers: { [name]: { command: "server" } } }));
        write(entry.targetPath, JSON.stringify({ mcpServers: { user: { command: "user-server" } } }));
        await runInstall(options);
        expect(Object.keys((readMergeableConfig(entry.targetPath) as any).mcpServers).sort()).toEqual(
          [name, "user"].sort(),
        );
        write(entry.generatedPath, '{"mcpServers":{}}');
        await runInstall({ ...options, prune });
        await runInstall(options);
        const servers = (readMergeableConfig(entry.targetPath) as any).mcpServers;
        expect(Object.hasOwn(servers, name)).toBe(!prune);
        if (!prune) expect(servers[name]).toEqual({ command: "server" });
        expect(servers.user).toEqual({ command: "user-server" });
        expect(
          JSON.parse(read(join(platformConfigDir(platform, options.destBase, options.userHome), ".ulis-manifest.json")))
            .mcpServers,
        ).toEqual([]);
      });
    }
  }
}
