import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PLATFORMS } from "../platforms.js";
import {
  applyTuiPreferences,
  getTuiPreferencesPath,
  loadTuiPreferences,
  saveTuiPreferences,
  snapshotTuiPreferences,
} from "./preferences.js";
import { createInitialState, handleTuiKey } from "./state.js";

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
  it("loads legacy preferences into their flow scope without overriding the start screen", () => {
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
    expect(state.sourceMode).toBe("project");
    expect(state.destinationMode).toBe("project");

    state.cursor = 2;
    handleTuiKey(state, "enter");

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
      presetSourceMode: "sideways" as never,
      backup: "nope" as never,
      rebuild: null as never,
    });

    expect(state.sourceMode).toBe("project");
    expect(state.destinationMode).toBe("project");
    expect(state.customSource).toBe("");
    expect(state.recentCustomSources).toEqual(["/a"]);
    expect(state.platforms).toEqual(["codex"]);
    expect(state.selectedPresetNames).toEqual(["team"]);
    expect(state.presetSourceMode).toBe("auto");
    expect(state.backup).toBe(true);
    expect(state.rebuild).toBe(true);
  });

  it("falls back to all platforms when scoped preferences contain an empty platform list", () => {
    const state = createInitialState();

    applyTuiPreferences(state, {
      version: 2,
      scopes: {
        project: {
          platforms: [],
        },
      },
    });

    expect(state.platforms).toEqual([...PLATFORMS]);
  });

  it("ignores preferences from newer schema versions", () => {
    const state = createInitialState();

    applyTuiPreferences(state, {
      version: 999,
      scopes: {
        project: {
          platforms: ["codex"],
          backup: false,
        },
      },
    });

    expect(state.platforms).toEqual([...PLATFORMS]);
    expect(state.backup).toBe(true);
  });

  it("only snapshots custom source paths for the custom flow", () => {
    const state = createInitialState();
    state.flow = "project";
    state.customSource = "/tmp/project/.ulis";

    const preferences = snapshotTuiPreferences(state);

    expect(preferences.scopes?.project?.customSource).toBeUndefined();
  });

  it("saves the current state to disk", () => {
    const root = createTempRoot();
    const filePath = join(root, "prefs.json");
    const state = createInitialState([{ name: "team", displayName: "Team", description: "", source: "user", dir: "" }]);
    state.flow = "custom";
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
      version: 2,
      scopes: {
        custom: {
          destinationMode: "global",
          customSource: "/tmp/project/.ulis",
          recentCustomSources: ["/tmp/project/.ulis", "/tmp/team/.ulis"],
          platforms: ["claude", "codex"],
          selectedPresetNames: ["team"],
          presetSourceMode: "auto",
          backup: false,
          rebuild: false,
          presetInstallExtensions: true,
        },
      },
    });
  });

  it("stores preferences outside the .ulis source tree by default", () => {
    expect(getTuiPreferencesPath("/home/test")).toBe(join("/home/test", ".ulis-tui.json"));
  });
});
