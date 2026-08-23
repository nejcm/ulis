import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { type Logger } from "./build.js";
import { __test, runInstall } from "./install.js";
import { InstallError } from "./install/errors.js";
import { ParseError } from "./parsers/index.js";
import { cleanupInstallTempRoots, createTempRoot, read, write } from "./test-utils/install.js";
import { PreservedNativeConfigParseError } from "./utils/preserved-native-configs.js";

afterEach(() => {
  __test.resetRuntimeDependencies();
  cleanupInstallTempRoots();
});

// runInstall: platform-loop summarization and interrupt handling, plus skill/extension spawn failures.
describe("runInstall", () => {
  function createPlatformReportFixture() {
    const root = createTempRoot();
    const sourceDir = join(root, "source");
    const outputDir = join(sourceDir, "generated");
    const destBase = join(root, "destination");
    const homeDir = join(root, "home");
    write(join(sourceDir, "config.yaml"), "version: 1\nname: test\n");
    write(join(outputDir, "claude", "agents", "worker.md"), "Claude worker.\n");
    write(join(outputDir, "codex", "AGENTS.md"), "Codex instructions.\n");
    mkdirSync(homeDir, { recursive: true });
    return { sourceDir, outputDir, destBase, homeDir };
  }

  function captureLogger(logs: string[], onHeader?: (message: string) => void): Logger {
    const record = (message: string) => logs.push(message);
    return {
      info: record,
      success: record,
      warn: record,
      error: record,
      dim: record,
      header(message) {
        record(message);
        onHeader?.(message);
      },
    };
  }

  it("summarizes successful platform installs without an empty failure list", async () => {
    const fixture = createPlatformReportFixture();
    const logs: string[] = [];

    await runInstall({
      sourceDir: fixture.sourceDir,
      outputDir: fixture.outputDir,
      destBase: fixture.destBase,
      userHome: fixture.homeDir,
      platforms: ["claude", "codex"],
      rebuild: false,
      installExtensions: false,
      installSkills: false,
      logger: captureLogger(logs),
    });

    expect(logs).toContain("Install summary — installed: [claude, codex]");
    expect(logs.some((line) => line.includes("failed: ["))).toBe(false);
  });

  it("continues after a platform failure, preserves its error, and does not write its manifest", async () => {
    const fixture = createPlatformReportFixture();
    const logs: string[] = [];
    let error: unknown;
    write(join(fixture.destBase, ".mcp.json"), "{invalid");

    try {
      await runInstall({
        sourceDir: fixture.sourceDir,
        outputDir: fixture.outputDir,
        destBase: fixture.destBase,
        userHome: fixture.homeDir,
        platforms: ["claude", "codex"],
        rebuild: false,
        installExtensions: false,
        installSkills: false,
        logger: captureLogger(logs),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InstallError);
    expect((error as Error).message).toBe(
      `Failed to parse existing native config at ${join(fixture.destBase, ".mcp.json")}`,
    );
    expect((error as Error).cause).toBeInstanceOf(PreservedNativeConfigParseError);
    expect(logs).toContain("Install summary — installed: [codex], failed: [claude]");
    expect(read(join(fixture.destBase, ".codex", "AGENTS.md"))).toBe("Codex instructions.\n");
    expect(existsSync(join(fixture.destBase, ".codex", ".ulis-manifest.json"))).toBe(true);
    expect(existsSync(join(fixture.destBase, ".claude", ".ulis-manifest.json"))).toBe(false);
  });

  it("propagates an interrupt during the platform loop without reporting a platform failure", async () => {
    const fixture = createPlatformReportFixture();
    const logs: string[] = [];
    const controller = new AbortController();
    write(join(fixture.destBase, ".codex", "config.toml"), "[");
    const logger = captureLogger(logs, (message) => {
      if (message === "Installing Codex") controller.abort();
    });

    let error: unknown;
    try {
      await runInstall({
        sourceDir: fixture.sourceDir,
        outputDir: fixture.outputDir,
        destBase: fixture.destBase,
        userHome: fixture.homeDir,
        platforms: ["claude", "codex"],
        rebuild: false,
        installExtensions: false,
        installSkills: false,
        logger,
        signal: controller.signal,
      });
    } catch (caught) {
      error = caught;
    }

    const cause = error instanceof Error ? error.cause : undefined;
    expect({
      error: error instanceof Error ? error.message : String(error),
      cause: cause instanceof Error ? cause.message : String(cause),
      failureSummary: logs.find((line) => line.includes("failed: [")),
      summary: logs.find((line) => line.startsWith("Install summary")),
    }).toEqual({
      error: "Install stopped by user.",
      cause: `Failed to parse existing native config at ${join(fixture.destBase, ".codex", "config.toml")}`,
      failureSummary: undefined,
      summary: "Install summary — installed: [claude]",
    });
    expect((cause as Error).cause).toBeInstanceOf(PreservedNativeConfigParseError);
    expect(read(join(fixture.destBase, ".claude", "agents", "worker.md"))).toBe("Claude worker.\n");
    expect(existsSync(join(fixture.destBase, ".claude", ".ulis-manifest.json"))).toBe(true);
    expect(read(join(fixture.destBase, ".codex", "config.toml"))).toBe("[");
    expect(existsSync(join(fixture.destBase, ".codex", "AGENTS.md"))).toBe(false);
    expect(existsSync(join(fixture.destBase, ".codex", ".ulis-manifest.json"))).toBe(false);
  });

  // A signal handler runs as a macrotask, and every installer body is synchronous (`cpSync`,
  // `writeFileSync`). Without a turn of the event loop per platform the loop drains through the
  // microtask queue and the abort is only seen once every platform has already been written -
  // which is the whole write phase, not "between platforms". `setImmediate` stands in for the
  // handler so the test does not depend on real signal delivery.
  it("observes an interrupt queued during the write phase before the next platform", async () => {
    const fixture = createPlatformReportFixture();
    const logs: string[] = [];
    const controller = new AbortController();
    const logger = captureLogger(logs, (message) => {
      if (message === "Installing Claude Code") setImmediate(() => controller.abort());
    });

    let error: unknown;
    try {
      await runInstall({
        sourceDir: fixture.sourceDir,
        outputDir: fixture.outputDir,
        destBase: fixture.destBase,
        userHome: fixture.homeDir,
        platforms: ["claude", "codex"],
        rebuild: false,
        installExtensions: false,
        installSkills: false,
        logger,
        signal: controller.signal,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error instanceof Error ? error.message : String(error)).toBe("Install stopped by user.");
    expect(read(join(fixture.destBase, ".claude", "agents", "worker.md"))).toBe("Claude worker.\n");
    expect(existsSync(join(fixture.destBase, ".codex", "AGENTS.md"))).toBe(false);
    expect(logs).toContain("Install summary — installed: [claude]");
  });

  it("reports recorded failures when a later platform is interrupted", async () => {
    for (const platforms of [
      ["claude", "codex"],
      ["claude", "codex", "cursor"],
    ] as const) {
      const fixture = createPlatformReportFixture();
      const logs: string[] = [];
      const controller = new AbortController();
      write(join(fixture.destBase, ".mcp.json"), "{invalid");
      const logger = captureLogger(logs, (message) => {
        if (message === "Installing Codex") controller.abort();
      });

      let error: unknown;
      try {
        await runInstall({
          sourceDir: fixture.sourceDir,
          outputDir: fixture.outputDir,
          destBase: fixture.destBase,
          userHome: fixture.homeDir,
          platforms,
          rebuild: false,
          installExtensions: false,
          installSkills: false,
          logger,
          signal: controller.signal,
        });
      } catch (caught) {
        error = caught;
      }

      const cause = error instanceof Error ? error.cause : undefined;
      expect({
        error: error instanceof Error ? error.message : String(error),
        cause: cause instanceof Error ? cause.message : String(cause),
        summary: logs.find((line) => line.startsWith("Install summary")),
      }).toEqual({
        error: "Install stopped by user.",
        cause: `Failed to parse existing native config at ${join(fixture.destBase, ".mcp.json")}`,
        summary: "Install summary — installed: [codex], failed: [claude]",
      });
      expect(cause).toBeInstanceOf(InstallError);
      expect((cause as Error).cause).toBeInstanceOf(PreservedNativeConfigParseError);
      expect(existsSync(join(fixture.destBase, ".claude", ".ulis-manifest.json"))).toBe(false);
      expect(existsSync(join(fixture.destBase, ".codex", ".ulis-manifest.json"))).toBe(true);
      expect(existsSync(join(fixture.destBase, ".cursor"))).toBe(false);
    }
  });

  it("reports a malformed skills.yaml as a diagnostic when install reaches it first", async () => {
    const fixture = createPlatformReportFixture();
    write(join(fixture.sourceDir, "skills.yaml"), ["claude:", "  skills:", "    - args: [--flag]", ""].join("\n"));

    let captured: unknown;
    await expect(
      runInstall({
        sourceDir: fixture.sourceDir,
        outputDir: fixture.outputDir,
        destBase: fixture.destBase,
        userHome: fixture.homeDir,
        platforms: ["claude"],
        rebuild: false,
        installExtensions: false,
        logger: captureLogger([]),
      }).catch((err: unknown) => {
        captured = err;
        throw err;
      }),
    ).rejects.toThrow(ParseError);

    const diag = (captured as ParseError).toDiagnostic();
    expect(diag.relativeFile).toBe("skills.yaml");
    expect(diag.fieldPath).toBe("claude.skills[].name");
    expect(diag.target).toBe("claude");
  });

  it("fails and summarizes a thrown external skill spawn error", async () => {
    const fixture = createPlatformReportFixture();
    const logs: string[] = [];
    write(join(fixture.sourceDir, "skills.yaml"), ["codex:", "  skills:", "    - name: skill/bad", ""].join("\n"));
    __test.setRuntimeDependencies({
      async runAsyncCommand() {
        throw new Error("spawn failed");
      },
    });

    const install = runInstall({
      sourceDir: fixture.sourceDir,
      outputDir: fixture.outputDir,
      destBase: fixture.destBase,
      userHome: fixture.homeDir,
      platforms: ["codex"],
      rebuild: false,
      installExtensions: false,
      logger: captureLogger(logs),
    });

    await expect(install).rejects.toThrow("1 external skill or extension command failed.");
    expect(logs.filter((line) => line.startsWith("Install summary"))).toEqual([
      "Install summary — installed: [codex], failed external skills: [codex: skill/bad]",
    ]);
    expect(logs).not.toContain("Installation Complete");
  });

  it("fails and summarizes extension non-zero exits and spawn errors", async () => {
    const fixture = createPlatformReportFixture();
    const logs: string[] = [];
    write(
      join(fixture.sourceDir, "extensions.yaml"),
      ["codex:", "  extensions:", "    - name: extension/non-zero", "    - name: extension/spawn-error", ""].join("\n"),
    );
    __test.setRuntimeDependencies({
      runCommand: () => ({ status: 0, stdout: "", stderr: "" }) as never,
      async runAsyncCommand(_command, args) {
        if (args.includes("extension/non-zero")) {
          return { status: 7, stdout: "", stderr: "extension exited 7" };
        }
        throw new Error("spawn failed");
      },
    });

    const install = runInstall({
      sourceDir: fixture.sourceDir,
      outputDir: fixture.outputDir,
      destBase: fixture.destBase,
      userHome: fixture.homeDir,
      platforms: ["codex"],
      rebuild: false,
      installSkills: false,
      logger: captureLogger(logs),
      runner: "npx",
    });

    await expect(install).rejects.toThrow("2 external skill or extension commands failed.");
    expect(logs.filter((line) => line.startsWith("Install summary"))).toEqual([
      "Install summary — installed: [codex], failed extensions: [codex: extension/non-zero, codex: extension/spawn-error]",
    ]);
    expect(logs).not.toContain("Installation Complete");
  });

  it("fails named extensions when the runner is missing and names the skip flag", async () => {
    const fixture = createPlatformReportFixture();
    const logs: string[] = [];
    write(
      join(fixture.sourceDir, "extensions.yaml"),
      ["codex:", "  extensions:", "    - name: extension/one", "    - name: extension/two", ""].join("\n"),
    );
    __test.setRuntimeDependencies({
      runCommand: () => ({ status: 1, stdout: "", stderr: "" }) as never,
      async runAsyncCommand() {
        throw new Error("extension command must not run without a runner");
      },
    });

    const install = runInstall({
      sourceDir: fixture.sourceDir,
      outputDir: fixture.outputDir,
      destBase: fixture.destBase,
      userHome: fixture.homeDir,
      platforms: ["codex"],
      rebuild: false,
      installSkills: false,
      logger: captureLogger(logs),
      runner: "npx",
    });

    await expect(install).rejects.toThrow("2 external skill or extension commands failed.");
    expect(logs).toContain(
      "npx not found on PATH - failed to install codex extensions. Pass --skip-extensions to proceed without them.",
    );
    expect(logs.filter((line) => line.startsWith("Install summary"))).toEqual([
      "Install summary — installed: [codex], failed extensions: [codex: extension/one, codex: extension/two]",
    ]);
    expect(logs).not.toContain("Installation Complete");
  });

  it("keeps skill and extension spawn aborts as interruptions", async () => {
    for (const kind of ["skill", "extension"] as const) {
      const fixture = createPlatformReportFixture();
      const logs: string[] = [];
      const controller = new AbortController();
      write(
        join(fixture.sourceDir, kind === "skill" ? "skills.yaml" : "extensions.yaml"),
        ["codex:", `  ${kind}s:`, `    - name: ${kind}/aborted`, ""].join("\n"),
      );
      __test.setRuntimeDependencies({
        runCommand: () => ({ status: 0, stdout: "", stderr: "" }) as never,
        async runAsyncCommand() {
          controller.abort();
          throw new Error("spawn aborted");
        },
      });

      let error: unknown;
      try {
        await runInstall({
          sourceDir: fixture.sourceDir,
          outputDir: fixture.outputDir,
          destBase: fixture.destBase,
          userHome: fixture.homeDir,
          platforms: ["codex"],
          rebuild: false,
          installSkills: kind === "skill",
          installExtensions: kind === "extension",
          logger: captureLogger(logs),
          runner: "npx",
          signal: controller.signal,
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Install stopped by user.");
      expect(logs.filter((line) => line.startsWith("Install summary"))).toEqual([
        "Install summary — installed: [codex]",
      ]);
      expect(logs.some((line) => line.includes(`failed ${kind}`))).toBe(false);
      expect(logs).not.toContain("Installation Complete");
    }
  });
});
