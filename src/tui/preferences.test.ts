import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyTuiPreferences, getTuiPreferencesPath, loadTuiPreferences, saveTuiPreferences } from "./preferences.js";
import { createInitialState } from "./state.js";

const tmpRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-tui-prefs-"));
  tmpRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("tui preferences", () => {
  it("loads saved platforms and presets into state", () => {
    const root = createTempRoot();
    const filePath = join(root, "prefs.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        sourceMode: "custom",
        destinationMode: "global",
        customSource: " /workspace/.ulis ",
        recentCustomSources: [" /workspace/.ulis ", "/workspace/team/.ulis", "", "/workspace/old/.ulis"],
        platforms: ["codex", "cursor"],
        selectedPresetNames: ["missing", "team"],
        backup: false,
        rebuild: false,
      }),
    );
    const state = createInitialState([{ name: "team", displayName: "Team", description: "", source: "user", dir: "" }]);

    const error = loadTuiPreferences(state, filePath);

    expect(error).toBeUndefined();
    expect(state.sourceMode).toBe("custom");
    expect(state.destinationMode).toBe("global");
    expect(state.customSource).toBe("/workspace/.ulis");
    expect(state.recentCustomSources).toEqual(["/workspace/.ulis", "/workspace/team/.ulis", "/workspace/old/.ulis"]);
    expect(state.platforms).toEqual(["codex", "cursor"]);
    expect(state.selectedPresetNames).toEqual(["team"]);
    expect(state.backup).toBe(false);
    expect(state.rebuild).toBe(false);
  });

  it("ignores invalid values and keeps defaults", () => {
    const state = createInitialState([{ name: "team", displayName: "Team", description: "", source: "user", dir: "" }]);

    applyTuiPreferences(state, {
      sourceMode: "weird" as never,
      destinationMode: "sideways" as never,
      customSource: "  ",
      recentCustomSources: ["  ", "/a", "/a", 42 as never],
      platforms: ["codex", "bogus" as never],
      selectedPresetNames: ["team", 42 as never],
      backup: "nope" as never,
      rebuild: null as never,
    });

    expect(state.sourceMode).toBe("project");
    expect(state.destinationMode).toBe("project");
    expect(state.customSource).toBe("");
    expect(state.recentCustomSources).toEqual(["/a"]);
    expect(state.platforms).toEqual(["codex"]);
    expect(state.selectedPresetNames).toEqual(["team"]);
    expect(state.backup).toBe(true);
    expect(state.rebuild).toBe(true);
  });

  it("saves the current state to disk", () => {
    const root = createTempRoot();
    const filePath = join(root, "prefs.json");
    const state = createInitialState([{ name: "team", displayName: "Team", description: "", source: "user", dir: "" }]);
    state.sourceMode = "custom";
    state.destinationMode = "global";
    state.customSource = "/tmp/project/.ulis";
    state.recentCustomSources = ["/tmp/project/.ulis", "/tmp/team/.ulis"];
    state.platforms = ["claude", "codex"];
    state.selectedPresetNames = ["team"];
    state.backup = false;
    state.rebuild = false;

    const error = saveTuiPreferences(state, filePath);

    expect(error).toBeUndefined();
    expect(JSON.parse(readFileSync(filePath, "utf-8"))).toEqual({
      sourceMode: "custom",
      destinationMode: "global",
      customSource: "/tmp/project/.ulis",
      recentCustomSources: ["/tmp/project/.ulis", "/tmp/team/.ulis"],
      platforms: ["claude", "codex"],
      selectedPresetNames: ["team"],
      backup: false,
      rebuild: false,
    });
  });

  it("stores preferences outside the .ulis source tree by default", () => {
    expect(getTuiPreferencesPath("/home/test")).toBe(join("/home/test", ".ulis-tui.json"));
  });
});
