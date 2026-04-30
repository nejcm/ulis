import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parsePresetNames, resolvePresets } from "./resolve-presets.js";

const tmpRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-presets-"));
  tmpRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("resolvePresets", () => {
  it("throws in non-interactive mode when a preset is missing", async () => {
    const root = createTempRoot();
    const presetsRoot = join(root, "presets");
    const bundledRoot = join(root, "bundled-presets");
    mkdirSync(join(presetsRoot, "base"), { recursive: true });
    mkdirSync(bundledRoot, { recursive: true });

    await expect(
      resolvePresets(["base", "missing"], { presetsRoot, bundledPresetsRoot: bundledRoot, nonInteractive: true }),
    ).rejects.toThrow(`Preset "missing" not found in ${presetsRoot} or ${bundledRoot}.`);
  });

  it("skips missing presets when configured", async () => {
    const root = createTempRoot();
    const presetsRoot = join(root, "presets");
    mkdirSync(join(presetsRoot, "preset-a"), { recursive: true });

    await expect(resolvePresets(["preset-a", "missing"], { presetsRoot, onMissing: "skip" })).resolves.toEqual([
      { name: "preset-a", dir: join(presetsRoot, "preset-a") },
    ]);
  });

  it("preserves resolved preset ordering", async () => {
    const root = createTempRoot();
    const presetsRoot = join(root, "presets");
    mkdirSync(join(presetsRoot, "a"), { recursive: true });
    mkdirSync(join(presetsRoot, "b"), { recursive: true });

    await expect(resolvePresets(["b", "a"], { presetsRoot, nonInteractive: true })).resolves.toEqual([
      { name: "b", dir: join(presetsRoot, "b") },
      { name: "a", dir: join(presetsRoot, "a") },
    ]);
  });

  it("falls back to bundled presets when user preset is missing", async () => {
    const root = createTempRoot();
    const presetsRoot = join(root, "presets");
    const bundledRoot = join(root, "bundled-presets");
    mkdirSync(join(bundledRoot, "react-web"), { recursive: true });

    await expect(
      resolvePresets(["react-web"], { presetsRoot, bundledPresetsRoot: bundledRoot, nonInteractive: true }),
    ).resolves.toEqual([{ name: "react-web", dir: join(bundledRoot, "react-web") }]);
  });

  it("prefers user preset over bundled preset with same name", async () => {
    const root = createTempRoot();
    const presetsRoot = join(root, "presets");
    const bundledRoot = join(root, "bundled-presets");
    mkdirSync(join(presetsRoot, "react-web"), { recursive: true });
    mkdirSync(join(bundledRoot, "react-web"), { recursive: true });

    await expect(
      resolvePresets(["react-web"], { presetsRoot, bundledPresetsRoot: bundledRoot, nonInteractive: true }),
    ).resolves.toEqual([{ name: "react-web", dir: join(presetsRoot, "react-web") }]);
  });
});

describe("parsePresetNames", () => {
  it("supports comma-separated and repeated flags", () => {
    expect(parsePresetNames(["one,two", "three"])).toEqual(["one", "two", "three"]);
  });
});
