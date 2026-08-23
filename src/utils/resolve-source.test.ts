import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { __test } from "../install.js";
import { cleanupTempRoots, createTempRoot } from "../test-utils/fs.js";
import { resolveSource, resolveSourceOrRemote } from "./resolve-source.js";

afterEach(cleanupTempRoots);

describe("resolveSource", () => {
  it("uses an explicit source while keeping global installs pointed at home", () => {
    const root = createTempRoot("ulis-resolve-");
    const sourceDir = join(root, "example");
    mkdirSync(sourceDir, { recursive: true });

    expect(resolveSource({ cwd: root, source: "example", global: true })).toEqual({
      sourceDir,
      destBase: homedir(),
      mode: "global",
    });
  });

  it("installs alongside an explicit source when global mode is not set", () => {
    const root = createTempRoot("ulis-resolve-");
    const sourceDir = join(root, "example");
    mkdirSync(sourceDir, { recursive: true });

    expect(resolveSource({ cwd: root, source: "example" })).toEqual({
      sourceDir,
      destBase: root,
      mode: "source",
    });
  });

  it("uses the project-local .ulis source by default", () => {
    const root = createTempRoot("ulis-resolve-");
    const sourceDir = join(root, ".ulis");
    mkdirSync(sourceDir, { recursive: true });

    expect(resolveSource({ cwd: root })).toEqual({
      sourceDir,
      destBase: root,
      mode: "project",
    });
  });

  it("throws an init hint when the default project source is missing", () => {
    const root = createTempRoot("ulis-resolve-");

    expect(() => resolveSource({ cwd: root })).toThrow(
      `No .ulis/ folder in ${root}. Run 'ulis init' to scaffold one, or use '--global' / '--source <path>'.`,
    );
  });

  it("throws the resolved path when an explicit source is missing", () => {
    const root = createTempRoot("ulis-resolve-");
    const missing = join(root, "missing");

    expect(() => resolveSource({ cwd: root, source: "missing" })).toThrow(`--source path does not exist: ${missing}`);
  });
});

describe("resolveSourceOrRemote", () => {
  /** Stub the clone so no network or `git` is involved. */
  function mockClone(): void {
    __test.setRuntimeDependencies({
      runCommand() {
        return { status: 0 } as never;
      },
      async runAsyncCommand(_command, args) {
        mkdirSync(args[args.length - 1]!, { recursive: true });
        return { status: 0, stdout: "", stderr: "" };
      },
    });
  }

  afterEach(() => {
    __test.resetRuntimeDependencies();
  });

  it("installs a remote source into the cwd", async () => {
    const root = createTempRoot("ulis-resolve-");
    mockClone();

    const resolved = await resolveSourceOrRemote({ cwd: root, source: "https://github.com/o/r" });
    try {
      expect(resolved.destBase).toBe(root);
      expect(resolved.mode).toBe("remote");
      expect(existsSync(resolved.sourceDir)).toBe(true);
    } finally {
      resolved.cleanup();
    }
    expect(existsSync(resolved.sourceDir)).toBe(false);
  });

  it("installs a remote source into home with --global", async () => {
    const root = createTempRoot("ulis-resolve-");
    mockClone();

    const resolved = await resolveSourceOrRemote({ cwd: root, source: "https://github.com/o/r", global: true });
    try {
      expect(resolved.destBase).toBe(homedir());
      expect(resolved.mode).toBe("remote");
    } finally {
      resolved.cleanup();
    }
  });

  it("delegates a local source to resolveSource, with a no-op cleanup", async () => {
    const root = createTempRoot("ulis-resolve-");
    const sourceDir = join(root, "example");
    mkdirSync(sourceDir, { recursive: true });

    const resolved = await resolveSourceOrRemote({ cwd: root, source: "example" });
    expect({ sourceDir: resolved.sourceDir, destBase: resolved.destBase, mode: resolved.mode }).toEqual({
      sourceDir,
      destBase: root,
      mode: "source",
    });
    // Always callable, so callers register it without checking. Removing nothing is the point.
    expect(() => resolved.cleanup()).not.toThrow();
  });

  it("delegates a Windows drive-letter source to resolveSource", async () => {
    const root = createTempRoot("ulis-resolve-");

    await expect(resolveSourceOrRemote({ cwd: root, source: "C:\\presets" })).rejects.toThrow(
      /--source path does not exist/u,
    );
  });
});
