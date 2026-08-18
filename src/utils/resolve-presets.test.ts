import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { __test } from "../install.js";
import { createTempRoot } from "../test-utils/fs.js";
import { parsePresetNames, resolvePresets } from "./resolve-presets.js";

describe("resolvePresets", () => {
  it("throws in non-interactive mode when a preset is missing", async () => {
    const root = createTempRoot("ulis-presets-");
    const presetsRoot = join(root, "presets");
    const bundledRoot = join(root, "bundled-presets");
    mkdirSync(join(presetsRoot, "base"), { recursive: true });
    mkdirSync(bundledRoot, { recursive: true });

    await expect(
      resolvePresets(["base", "missing"], { presetsRoot, bundledPresetsRoot: bundledRoot, nonInteractive: true }),
    ).rejects.toThrow(`Preset "missing" not found in ${presetsRoot} or ${bundledRoot}.`);
  });

  it("skips missing presets when configured", async () => {
    const root = createTempRoot("ulis-presets-");
    const presetsRoot = join(root, "presets");
    mkdirSync(join(presetsRoot, "preset-a"), { recursive: true });

    const { presets } = await resolvePresets(["preset-a", "missing"], { presetsRoot, onMissing: "skip" });
    expect(presets).toEqual([{ name: "preset-a", dir: join(presetsRoot, "preset-a") }]);
  });

  it("preserves resolved preset ordering", async () => {
    const root = createTempRoot("ulis-presets-");
    const presetsRoot = join(root, "presets");
    mkdirSync(join(presetsRoot, "a"), { recursive: true });
    mkdirSync(join(presetsRoot, "b"), { recursive: true });

    const { presets } = await resolvePresets(["b", "a"], { presetsRoot, nonInteractive: true });
    expect(presets).toEqual([
      { name: "b", dir: join(presetsRoot, "b") },
      { name: "a", dir: join(presetsRoot, "a") },
    ]);
  });

  it("falls back to bundled presets when user preset is missing", async () => {
    const root = createTempRoot("ulis-presets-");
    const presetsRoot = join(root, "presets");
    const bundledRoot = join(root, "bundled-presets");
    mkdirSync(join(bundledRoot, "react-web"), { recursive: true });

    const { presets } = await resolvePresets(["react-web"], {
      presetsRoot,
      bundledPresetsRoot: bundledRoot,
      nonInteractive: true,
    });
    expect(presets).toEqual([{ name: "react-web", dir: join(bundledRoot, "react-web") }]);
  });

  it("prefers user preset over bundled preset with same name", async () => {
    const root = createTempRoot("ulis-presets-");
    const presetsRoot = join(root, "presets");
    const bundledRoot = join(root, "bundled-presets");
    mkdirSync(join(presetsRoot, "react-web"), { recursive: true });
    mkdirSync(join(bundledRoot, "react-web"), { recursive: true });

    const { presets } = await resolvePresets(["react-web"], {
      presetsRoot,
      bundledPresetsRoot: bundledRoot,
      nonInteractive: true,
    });
    expect(presets).toEqual([{ name: "react-web", dir: join(presetsRoot, "react-web") }]);
  });
});

describe("resolvePresets with remote refs", () => {
  /** Stub the clone so no network or `git` is involved. */
  function mockClone(options: { status?: number; build?: (dir: string) => void } = {}): void {
    __test.setRuntimeDependencies({
      runCommand(_lookup, args) {
        // `git` is on PATH, `gh` is not - so a failed clone takes no retry path.
        return { status: args[0] === "gh" ? 1 : 0 } as never;
      },
      async runAsyncCommand(command, args) {
        if (command !== "git") return { status: 0, stdout: "", stderr: "" };
        const status = options.status ?? 0;
        if (status === 0) {
          const dir = args[args.length - 1]!;
          mkdirSync(dir, { recursive: true });
          options.build?.(dir);
        }
        return { status, stdout: "", stderr: "fatal: repository not found" };
      },
    });
  }

  afterEach(() => {
    __test.resetRuntimeDependencies();
  });

  it("resolves a URL ref to a cloned dir with the derived name", async () => {
    mockClone({ build: (dir) => writeFileSync(join(dir, "preset.yaml"), "name: Team\n") });

    const { presets, cleanup } = await resolvePresets(["https://github.com/o/team-preset"], { nonInteractive: true });
    try {
      expect(presets).toHaveLength(1);
      expect(presets[0]!.name).toBe("Team");
      expect(presets[0]!.remoteUrl).toBe("https://github.com/o/team-preset");
      expect(existsSync(presets[0]!.dir)).toBe(true);
    } finally {
      cleanup();
    }
    expect(existsSync(presets[0]!.dir)).toBe(false);
  });

  it("resolves a mixed local and URL list", async () => {
    const root = createTempRoot("ulis-presets-");
    const presetsRoot = join(root, "presets");
    mkdirSync(join(presetsRoot, "local"), { recursive: true });
    mockClone();

    const { presets, cleanup } = await resolvePresets(parsePresetNames("local,https://github.com/o/remote-preset"), {
      presetsRoot,
      nonInteractive: true,
    });
    try {
      expect(presets.map((preset) => preset.name)).toEqual(["local", "remote-preset"]);
      expect(presets[0]!.remoteUrl).toBeUndefined();
      expect(presets[1]!.remoteUrl).toBe("https://github.com/o/remote-preset");
    } finally {
      cleanup();
    }
  });

  it("throws on a clone failure even when missing presets are skipped", async () => {
    mockClone({ status: 1 });

    await expect(resolvePresets(["https://github.com/o/r"], { onMissing: "skip" })).rejects.toThrow(/Failed to clone/u);
  });

  it("removes cloned dirs on failure part-way through a list", async () => {
    let clones = 0;
    __test.setRuntimeDependencies({
      runCommand(_lookup, args) {
        return { status: args[0] === "gh" ? 1 : 0 } as never;
      },
      async runAsyncCommand(command, args) {
        if (command !== "git") return { status: 0, stdout: "", stderr: "" };
        clones += 1;
        if (clones > 1) return { status: 1, stdout: "", stderr: "fatal: repository not found" };
        mkdirSync(args[args.length - 1]!, { recursive: true });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    const before = tempRemoteDirs();
    await expect(
      resolvePresets(["https://github.com/o/first", "https://github.com/o/second"], { nonInteractive: true }),
    ).rejects.toThrow(/Failed to clone/u);
    // The first clone succeeded; its temp dir must not survive the failure of the second.
    expect(tempRemoteDirs()).toEqual(before);
  });

  it("returns a no-op cleanup for an all-local list", async () => {
    const root = createTempRoot("ulis-presets-");
    const presetsRoot = join(root, "presets");
    mkdirSync(join(presetsRoot, "local"), { recursive: true });

    const { presets, cleanup } = await resolvePresets(["local"], { presetsRoot, nonInteractive: true });
    cleanup();
    cleanup();
    expect(existsSync(presets[0]!.dir)).toBe(true);
  });
});

function tempRemoteDirs(): readonly string[] {
  return [...new Bun.Glob("ulis-remote-*").scanSync({ cwd: tmpdir(), onlyFiles: false })].sort();
}

describe("parsePresetNames", () => {
  it("supports comma-separated and repeated flags", () => {
    expect(parsePresetNames(["one,two", "three"])).toEqual(["one", "two", "three"]);
  });

  it("trims empty entries from comma-separated input", () => {
    expect(parsePresetNames([" one, ,two,, ", "three"])).toEqual(["one", "two", "three"]);
  });

  it("keeps a mixed local and URL list working", () => {
    expect(parsePresetNames("local,https://github.com/o/r")).toEqual(["local", "https://github.com/o/r"]);
  });

  it.each([
    ["comma in userinfo", "https://user:TOP,SECRET@github.com/o/r"],
    // Whitespace defeats a redactor that stops at it, so the entry must never be echoed.
    ["whitespace in userinfo", "https://user:TOP, SECRET@github.com/o/r"],
    // The extra slash empties the authority, pushing the credential into what looks like a path.
    ["empty authority", "https:///user:TOP,SECRET@github.com/o/r"],
  ])("rejects %s without leaking the credential", (_label, url) => {
    for (const input of [url, `local,${url}`, ["local", url]] as (string | string[])[]) {
      const message = (() => {
        try {
          parsePresetNames(input);
          return "unexpectedly parsed";
        } catch (error) {
          return (error as Error).message;
        }
      })();

      expect(message).toContain("must have a plain host");
      expect(message).not.toContain("TOP");
      expect(message).not.toContain("SECRET");
      // Nothing from the entry is echoed at all - not even the host.
      expect(message).not.toContain("github.com");
    }
  });

  it("never reaches a clone or a log line for an unsplittable URL", async () => {
    const lines: string[] = [];
    const push = (message: string) => void lines.push(message);
    const logger = { info: push, success: push, warn: push, error: push, dim: push, header: push };
    let cloneAttempts = 0;
    __test.setRuntimeDependencies({
      runCommand(_lookup, args) {
        return { status: args[0] === "gh" ? 1 : 0 } as never;
      },
      async runAsyncCommand(command, args) {
        if (command === "git") cloneAttempts += 1;
        mkdirSync(args[args.length - 1]!, { recursive: true });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    // The real call path: parse, then resolve. Parsing must reject before anything is cloned.
    for (const url of ["https://user:TOP, SECRET@github.com/o/r", "https:///user:TOP,SECRET@github.com/o/r"]) {
      const names = (() => {
        try {
          return parsePresetNames(`local,${url}`);
        } catch {
          return undefined;
        }
      })();
      expect(names).toBeUndefined();
      if (names) await resolvePresets(names, { logger, nonInteractive: true });
    }

    __test.resetRuntimeDependencies();
    expect(cloneAttempts).toBe(0);
    expect(lines.join("\n")).not.toContain("TOP");
    expect(lines.join("\n")).not.toContain("SECRET");
  });

  it("allows a comma outside the URL authority", () => {
    // Only the authority can hold credentials; a path comma is just a list separator.
    expect(parsePresetNames("https://github.com/o/r,local")).toEqual(["https://github.com/o/r", "local"]);
  });
});
