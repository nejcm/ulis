import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { __test, runInstall } from "./install.js";
import { cleanupInstallTempRoots, createTempRoot, silentLogger, write } from "./test-utils/install.js";

afterEach(() => {
  __test.resetRuntimeDependencies();
  cleanupInstallTempRoots();
});

/**
 * A remote source's `.env` is written by whoever owns the repository, and it is read before the user
 * has agreed to anything. Nothing in it serves a purpose the destination's own `.env` does not
 * already serve, so a cloned tree's file is not read at all.
 */
describe("a cloned source's .env", () => {
  async function runWithSource(
    sourceDir: string,
    options: { sourceIsRemote?: boolean; logs?: string[] } = {},
  ): Promise<(string | undefined)[]> {
    const root = dirname(dirname(sourceDir));
    const projectDir = join(root, "project");
    const outputDir = join(sourceDir, "generated");
    mkdirSync(projectDir, { recursive: true });
    write(join(outputDir, "codex", "AGENTS.md"), "Codex instructions.\n");
    write(join(sourceDir, ".env"), "TEAM_TOKEN=from-the-source-tree\n");
    write(join(sourceDir, "skills.yaml"), ['"*":', "  skills:", "    - name: test/skill", ""].join("\n"));

    const seen: (string | undefined)[] = [];
    __test.setRuntimeDependencies({
      runCommand: () => ({ status: 0, stdout: "", stderr: "" }) as never,
      async runAsyncCommand() {
        // Sampled where it would matter: the environment the approved `npx` actually runs in.
        seen.push(process.env.TEAM_TOKEN);
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    await runInstall({
      sourceDir,
      outputDir,
      destBase: projectDir,
      userHome: join(root, "home"),
      platforms: ["codex"],
      rebuild: false,
      logger: options.logs ? { ...silentLogger, info: (message) => void options.logs!.push(message) } : silentLogger,
      remoteSources: ["https://github.com/o/r"],
      nonInteractive: true,
      sourceIsRemote: options.sourceIsRemote,
    });
    return seen;
  }

  // 1.3: `isClonedSourceDir`'s path-prefix heuristic is gone. `sourceIsRemote` (from the resolver's
  // own `mode`) is the only input now, so a local directory that merely happens to be named like a
  // clone is no longer mistaken for one - it keeps its `.env`.
  it("is read for a local directory literally named like a clone, when the caller does not say it is remote", async () => {
    const root = createTempRoot();
    expect(await runWithSource(join(root, "ulis-remote-XyZ123", "repo"))).toEqual(["from-the-source-tree"]);
  });

  it("is still read for a source the user wrote", async () => {
    const root = createTempRoot();
    expect(await runWithSource(join(root, "workspace", ".ulis"))).toEqual(["from-the-source-tree"]);
  });

  // The resolver already knows: it returns `mode: "remote"`. That is the precise signal - every
  // caller passes it explicitly, whatever the path looks like.
  it("is not read when the caller says the source is remote, whatever the path looks like", async () => {
    const root = createTempRoot();
    const logs: string[] = [];
    expect(await runWithSource(join(root, "workspace", ".ulis"), { sourceIsRemote: true, logs })).toEqual([undefined]);
    // Silence would leave a user whose `.env` stopped working with nothing to go on.
    expect(logs.some((line) => line.includes("Skipped the source tree's .env"))).toBe(true);
  });
});
