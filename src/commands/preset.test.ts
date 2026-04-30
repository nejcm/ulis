import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { presetListCmd } from "./preset.js";

const tmpRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-preset-list-"));
  tmpRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("presetListCmd", () => {
  it("shows bundled presets when user root is empty", async () => {
    const root = createTempRoot();
    const userRoot = join(root, "presets");
    const bundledRoot = join(root, "bundled-presets");
    mkdirSync(join(bundledRoot, "react-web"), { recursive: true });

    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await presetListCmd({ presetsRoot: userRoot, bundledPresetsRoot: bundledRoot });
      const output = logSpy.mock.calls.flat().join("\n");
      expect(output).toContain("react-web (bundled)");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("uses user preset when same preset exists in both roots", async () => {
    const root = createTempRoot();
    const userRoot = join(root, "presets");
    const bundledRoot = join(root, "bundled-presets");
    mkdirSync(join(userRoot, "react-web"), { recursive: true });
    mkdirSync(join(bundledRoot, "react-web"), { recursive: true });
    writeFileSync(
      join(userRoot, "react-web", "preset.yaml"),
      ["name: User React Web", "description: user preset", "version: 1", ""].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(bundledRoot, "react-web", "preset.yaml"),
      ["name: Bundled React Web", "description: bundled preset", "version: 1", ""].join("\n"),
      "utf8",
    );

    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await presetListCmd({ presetsRoot: userRoot, bundledPresetsRoot: bundledRoot });
      const output = logSpy.mock.calls.flat().join("\n");
      expect(output).toContain("react-web (User React Web, user)");
      expect(output).not.toContain("Bundled React Web");
    } finally {
      logSpy.mockRestore();
    }
  });
});
