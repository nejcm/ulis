import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, lstatSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

import { __test, runInstall } from "./install.js";
import type { Platform } from "./platforms.js";
import { cleanupInstallTempRoots, createTempRoot, read, silentLogger, write } from "./test-utils/install.js";

afterEach(() => {
  __test.resetRuntimeDependencies();
  cleanupInstallTempRoots();
});

interface NativeConfig {
  name: string;
  content: string;
  keeps: string;
}

const CASES: { platform: Platform; dir: string; ext: string; natives: NativeConfig[] }[] = [
  {
    platform: "claude",
    dir: ".claude",
    ext: ".md",
    natives: [
      { name: "settings.json", content: '{\n  "theme": "mine"\n}\n', keeps: '"theme": "mine"' },
      { name: "settings.local.json", content: '{ "local": true }\n', keeps: '{ "local": true }\n' },
    ],
  },
  {
    platform: "codex",
    dir: ".codex",
    ext: ".md",
    natives: [{ name: "config.toml", content: '[tui]\ntheme = "mine"\n', keeps: 'theme = "mine"' }],
  },
  {
    platform: "cursor",
    dir: ".cursor",
    ext: ".mdc",
    natives: [{ name: "mcp.json", content: '{ "mcpServers": { "mine": { "command": "x" } } }\n', keeps: '"mine"' }],
  },
  {
    platform: "forgecode",
    dir: ".forge",
    ext: ".md",
    natives: [
      { name: ".mcp.json", content: '{ "mcpServers": { "mine": { "command": "x" } } }\n', keeps: '"mine"' },
      { name: ".forge.toml", content: 'model = "mine"\n', keeps: 'model = "mine"\n' },
    ],
  },
];

function rulesSource(platform: Platform, dir: string, global = false) {
  const root = createTempRoot();
  const sourceDir = join(root, ".ulis");
  const projectDir = join(root, "project");
  const userHome = join(root, "home");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(userHome, { recursive: true });
  write(join(sourceDir, "config.yaml"), "version: 1\nname: test\n");
  write(join(sourceDir, "rules", "a.md"), "Rule A.\n");
  write(join(sourceDir, "rules", "b.md"), "Rule B.\n");
  const destBase = global ? userHome : projectDir;
  const targetDir = join(destBase, dir);
  write(join(targetDir, "rules", "mine.md"), "Mine.\n");
  const options = {
    sourceDir,
    outputDir: join(sourceDir, "generated"),
    destBase,
    userHome,
    platforms: [platform] as const,
    rebuild: true,
    installSkills: false,
    installExtensions: false,
    logger: silentLogger,
  };
  const manifest = () => JSON.parse(read(join(targetDir, ".ulis-manifest.json"))) as { rootEntries: string[] };
  return { sourceDir, targetDir, options, manifest };
}

function plantStaleNativeManifest(targetDir: string, natives: readonly NativeConfig[]) {
  for (const native of natives) write(join(targetDir, native.name), native.content);
  write(
    join(targetDir, ".ulis-manifest.json"),
    JSON.stringify({ version: 3, agents: [], skills: [], rootEntries: natives.map((native) => native.name) }),
  );
}

describe.each(CASES)("runInstall $platform rules", ({ platform, dir, ext, natives }) => {
  it("prunes a rule removed from the source and keeps an unmanaged one", async () => {
    const { sourceDir, targetDir, options, manifest } = rulesSource(platform, dir);
    await runInstall(options);
    expect(read(join(targetDir, "rules", `a${ext}`))).toContain("Rule A.");
    expect(manifest().rootEntries).toEqual(expect.arrayContaining([`rules/a${ext}`, `rules/b${ext}`]));

    rmSync(join(sourceDir, "rules", "b.md"));
    await runInstall(options);
    expect(existsSync(join(targetDir, "rules", `b${ext}`))).toBe(false);
    expect(read(join(targetDir, "rules", "mine.md"))).toBe("Mine.\n");
    expect(manifest().rootEntries).toContain(`rules/a${ext}`);
    expect(manifest().rootEntries).not.toContain(`rules/b${ext}`);
  });

  it("prunes the old name of a renamed rule", async () => {
    const { sourceDir, targetDir, options } = rulesSource(platform, dir);
    await runInstall(options);
    renameSync(join(sourceDir, "rules", "b.md"), join(sourceDir, "rules", "c.md"));
    await runInstall(options);
    expect(existsSync(join(targetDir, "rules", `b${ext}`))).toBe(false);
    expect(existsSync(join(targetDir, "rules", `c${ext}`))).toBe(true);
  });

  it("keeps a removed rule with prune off and drops it from the manifest", async () => {
    const { sourceDir, targetDir, options, manifest } = rulesSource(platform, dir);
    await runInstall(options);
    rmSync(join(sourceDir, "rules", "b.md"));
    await runInstall({ ...options, prune: false });
    expect(existsSync(join(targetDir, "rules", `b${ext}`))).toBe(true);
    expect(manifest().rootEntries).not.toContain(`rules/b${ext}`);
  });

  it("keeps a stale rule on disk when a later copy fails", async () => {
    const { sourceDir, targetDir, options } = rulesSource(platform, dir);
    await runInstall(options);
    rmSync(join(sourceDir, "rules", "b.md"));
    write(join(sourceDir, "rules", "c.md"), "Rule C.\n");
    write(join(targetDir, "rules", `c${ext}`, "keep.txt"), "in the way\n");
    await expect(runInstall(options)).rejects.toThrow();
    expect(existsSync(join(targetDir, "rules", `b${ext}`))).toBe(true);
    expect(read(join(targetDir, "rules", `c${ext}`, "keep.txt"))).toBe("in the way\n");
  });

  it("never records or sweeps a preserved native config, even one an older manifest lists", async () => {
    const { targetDir, options, manifest } = rulesSource(platform, dir);
    plantStaleNativeManifest(targetDir, natives);
    await runInstall(options);
    for (const native of natives) {
      expect(read(join(targetDir, native.name))).toContain(native.keeps);
      expect(manifest().rootEntries).not.toContain(native.name);
    }
  });
});

it("never sweeps a global Claude settings file an older manifest lists", async () => {
  const natives = CASES[0]!.natives;
  const { targetDir, options } = rulesSource("claude", ".claude", true);
  plantStaleNativeManifest(targetDir, natives);
  await runInstall(options);
  for (const native of natives) expect(read(join(targetDir, native.name))).toContain(native.keeps);
});

it("keeps stale ForgeCode native-root rules on disk when the outer-tree copy fails", async () => {
  const { sourceDir, targetDir, options } = rulesSource("forgecode", ".forge");
  await runInstall(options);
  rmSync(join(sourceDir, "rules", "b.md"));
  rmSync(join(targetDir, "AGENTS.md"));
  write(join(targetDir, "AGENTS.md", "keep.txt"), "in the way\n");
  await expect(runInstall(options)).rejects.toThrow();
  expect(existsSync(join(targetDir, "rules", "b.md"))).toBe(true);
});

it("prunes a stale managed entry under ForgeCode's nested .forge name", async () => {
  const { sourceDir, targetDir, options, manifest } = rulesSource("forgecode", ".forge");
  write(join(sourceDir, "raw", "forgecode", ".forge", ".forge", "stale.md"), "Stale.\n");
  await runInstall(options);
  expect(manifest().rootEntries).toContain(".forge/stale.md");

  rmSync(join(sourceDir, "raw", "forgecode", ".forge", ".forge"), { recursive: true });
  await runInstall(options);
  expect(existsSync(join(targetDir, ".forge", "stale.md"))).toBe(false);
});

it("clears a stale ForgeCode native-root directory a raw fragment now needs as a file", async () => {
  const { sourceDir, targetDir, options } = rulesSource("forgecode", ".forge");
  write(join(sourceDir, "raw", "forgecode", ".forge", "foo", "old.md"), "Old.\n");
  await runInstall(options);
  expect(read(join(targetDir, "foo", "old.md"))).toBe("Old.\n");

  rmSync(join(sourceDir, "raw", "forgecode", ".forge", "foo"), { recursive: true });
  write(join(sourceDir, "raw", "forgecode", ".forge", "foo"), "New.\n");
  await runInstall(options);
  expect(lstatSync(join(targetDir, "foo")).isFile()).toBe(true);
  expect(read(join(targetDir, "foo"))).toBe("New.\n");
});
