import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listTuiPresets } from "./presets.js";

const tmpRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-tui-presets-"));
  tmpRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("listTuiPresets", () => {
  it("checks project and global preset roots by default", () => {
    const cwd = createTempRoot();
    const userHome = createTempRoot();
    const bundledRoot = createTempRoot();
    writePreset(join(cwd, ".ulis", "presets", "project-team"), "Project Team");
    writePreset(join(userHome, ".ulis", "presets", "global-team"), "Global Team");

    const presets = listTuiPresets({ cwd, userHome, bundledRoot });

    expect(presets.map((preset) => [preset.name, preset.source, preset.displayName])).toEqual([
      ["project-team", "project", "Project Team"],
      ["global-team", "global", "Global Team"],
    ]);
  });

  it("scans a custom preset root", () => {
    const customRoot = createTempRoot();
    writePreset(join(customRoot, "custom-team"), "Custom Team");

    const presets = listTuiPresets({
      cwd: createTempRoot(),
      userHome: createTempRoot(),
      bundledRoot: createTempRoot(),
      customRoot,
    });

    expect(presets).toContainEqual({
      name: "custom-team",
      source: "custom",
      displayName: "Custom Team",
      description: "",
      dir: join(customRoot, "custom-team"),
    });
  });
});

function writePreset(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "preset.yaml"), `version: 1\nname: ${name}\n`);
}
