import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

import { __test, runInstall } from "./install.js";
import { cleanupInstallTempRoots, createTempRoot, read, silentLogger, write } from "./test-utils/install.js";

afterEach(() => {
  __test.resetRuntimeDependencies();
  cleanupInstallTempRoots();
});

function antigravitySource() {
  const root = createTempRoot();
  const sourceDir = join(root, ".ulis");
  const projectDir = join(root, "project");
  const userHome = join(root, "home");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(userHome, { recursive: true });
  write(join(sourceDir, "config.yaml"), "version: 1\nname: test\n");
  write(join(sourceDir, "rules", "a.md"), "Rule A.\n");
  write(join(sourceDir, "rules", "b.md"), "Rule B.\n");
  const targetDir = join(projectDir, ".agents");
  write(join(targetDir, "rules", "mine.md"), "Mine.\n");
  const options = {
    sourceDir,
    outputDir: join(sourceDir, "generated"),
    destBase: projectDir,
    userHome,
    platforms: ["antigravity"] as const,
    rebuild: true,
    installSkills: false,
    installExtensions: false,
    logger: silentLogger,
  };
  const manifest = () => JSON.parse(read(join(targetDir, ".ulis-manifest.json"))) as { rootEntries: string[] };
  return { sourceDir, targetDir, options, manifest };
}

describe("runInstall antigravity rules", () => {
  it("prunes a rule removed from the source and keeps an unmanaged one", async () => {
    const { sourceDir, targetDir, options, manifest } = antigravitySource();
    await runInstall(options);
    expect(read(join(targetDir, "rules", "a.md"))).toContain("Rule A.");
    expect(manifest().rootEntries).toEqual(expect.arrayContaining(["rules/a.md", "rules/b.md"]));

    rmSync(join(sourceDir, "rules", "b.md"));
    await runInstall(options);
    expect(existsSync(join(targetDir, "rules", "b.md"))).toBe(false);
    expect(read(join(targetDir, "rules", "mine.md"))).toBe("Mine.\n");
    expect(manifest().rootEntries).toContain("rules/a.md");
    expect(manifest().rootEntries).not.toContain("rules/b.md");
  });

  it("prunes the old name of a renamed rule", async () => {
    const { sourceDir, targetDir, options } = antigravitySource();
    await runInstall(options);
    renameSync(join(sourceDir, "rules", "b.md"), join(sourceDir, "rules", "c.md"));
    await runInstall(options);
    expect(existsSync(join(targetDir, "rules", "b.md"))).toBe(false);
    expect(existsSync(join(targetDir, "rules", "c.md"))).toBe(true);
  });

  it("prunes a rule disabled for antigravity", async () => {
    const { sourceDir, targetDir, options } = antigravitySource();
    await runInstall(options);
    write(join(sourceDir, "rules", "b.md"), "---\nplatforms:\n  antigravity:\n    enabled: false\n---\nRule B.\n");
    await runInstall(options);
    expect(existsSync(join(targetDir, "rules", "b.md"))).toBe(false);
    expect(existsSync(join(targetDir, "rules", "a.md"))).toBe(true);
  });

  it("keeps a removed rule with prune off and drops it from the manifest", async () => {
    const { sourceDir, targetDir, options, manifest } = antigravitySource();
    await runInstall(options);
    rmSync(join(sourceDir, "rules", "b.md"));
    await runInstall({ ...options, prune: false });
    expect(existsSync(join(targetDir, "rules", "b.md"))).toBe(true);
    expect(manifest().rootEntries).not.toContain("rules/b.md");
  });
});
