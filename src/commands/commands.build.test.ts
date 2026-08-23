// initCmd and buildCmd: project/global scaffolding, generated-output targeting, --source override,
// and remote-source / unsupported-protocol rejection before any work happens.
import { afterEach, describe, expect, it } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildCmd } from "./build.js";
import { initCmd } from "./init.js";

const fixturesDir = resolve(join(import.meta.dirname, "../../tests/fixtures"));
const originalCwd = process.cwd();
const tmpRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-cmd-"));
  tmpRoots.push(root);
  return root;
}

function copyFixtureSource(projectRoot: string, dirname = ".ulis"): string {
  const sourceDir = join(projectRoot, dirname);
  cpSync(fixturesDir, sourceDir, { recursive: true });
  return sourceDir;
}

afterEach(() => {
  process.chdir(originalCwd);
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("commands", () => {
  it("initCmd scaffolds a project-local source tree", async () => {
    const projectRoot = createTempRoot();
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "command-test" }));
    process.chdir(projectRoot);

    await initCmd();

    expect(existsSync(join(projectRoot, ".ulis", "config.yaml"))).toBe(true);
    expect(existsSync(join(projectRoot, ".ulis", "extensions.yaml"))).toBe(true);
    expect(existsSync(join(projectRoot, ".ulis", "agents", ".gitkeep"))).toBe(true);
    expect(readFileSync(join(projectRoot, ".ulis", "config.yaml"), "utf8")).toContain("name: command-test");
    expect(readFileSync(join(projectRoot, ".ulis", "extensions.yaml"), "utf8")).toContain("extensions");
    expect(readFileSync(join(projectRoot, ".gitignore"), "utf8")).toContain("/.ulis/generated/");
  });

  it("initCmd points global schema refs at the installed package", async () => {
    const homeRoot = createTempRoot();

    await initCmd({ global: true, homeDir: homeRoot });

    const installedSchemas = pathToFileURL(resolve(join(import.meta.dirname, "../../schemas"))).href;
    expect(readFileSync(join(homeRoot, ".ulis", "config.yaml"), "utf8")).toContain(
      `$schema=${installedSchemas}/config.schema.json`,
    );
  });

  it("buildCmd writes selected generated output under the project source tree", async () => {
    const projectRoot = createTempRoot();
    copyFixtureSource(projectRoot);
    process.chdir(projectRoot);

    await buildCmd({ target: "claude" });

    expect(existsSync(join(projectRoot, ".ulis", "generated", "claude", "agents", "worker.md"))).toBe(true);
    expect(existsSync(join(projectRoot, ".ulis", "generated", "opencode"))).toBe(false);
  });

  it("buildCmd honors explicit --source over project-local source", async () => {
    const projectRoot = createTempRoot();
    copyFixtureSource(projectRoot, "custom-source");
    process.chdir(projectRoot);

    await buildCmd({ source: "custom-source", target: "cursor" });

    expect(existsSync(join(projectRoot, "custom-source", "generated", "cursor", "agents", "worker.mdc"))).toBe(true);
    expect(existsSync(join(projectRoot, ".ulis", "generated"))).toBe(false);
  });

  it("buildCmd with an empty target does not default to all platforms", async () => {
    const projectRoot = createTempRoot();
    copyFixtureSource(projectRoot);
    process.chdir(projectRoot);

    await buildCmd({ target: "" });

    expect(existsSync(join(projectRoot, ".ulis", "generated"))).toBe(false);
  });

  it("buildCmd rejects a remote source before doing any work", async () => {
    const projectRoot = createTempRoot();
    copyFixtureSource(projectRoot);
    process.chdir(projectRoot);

    await expect(buildCmd({ source: "https://github.com/o/r", target: "claude" })).rejects.toThrow(
      "build writes generated output into the source tree, and a remote source is discarded after the run. " +
        "Use `ulis install --source <url>` instead.",
    );

    // Rejected before any work: no clone, no generated output.
    expect(existsSync(join(projectRoot, ".ulis", "generated"))).toBe(false);
  });

  it("buildCmd rejects an unsupported protocol instead of pointing at install", async () => {
    // `ulis install` would refuse `git://` too, so sending the user there would waste a round trip.
    await expect(buildCmd({ source: "git://github.com/o/r", target: "claude" })).rejects.toThrow(/HTTPS or SSH/u);
  });
});
