// handleTuiKey: preset selection, resolution and ordering, the presets-only flow (no source
// required), the preset source-location picker (project/global/bundled/auto/custom), and the
// custom preset directory loader.
import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { cleanupTempRoots, createTempRoot } from "../test-utils/fs.js";
import { handleCustomSourceTextInputKey, handleTuiKey } from "./keys.js";
import {
  planItems,
  reviewFingerprint,
  selectedPresets,
  togglePresetSelection,
  visiblePresetChoices,
} from "./selectors.js";
import { createInitialState, type PlanItemId, type TuiState } from "./state-model.js";

const planCursor = (state: TuiState, id: PlanItemId) => planItems(state).findIndex((item) => item.id === id);

afterEach(() => {
  cleanupTempRoots();
});

describe("tui keys", () => {
  it("tracks preset selections and resolves them to directories", () => {
    const state: TuiState = createInitialState([
      { name: "team", displayName: "Team", description: "", source: "user", dir: "/presets/team" },
    ]);

    state.selectedPresetNames = togglePresetSelection(state.selectedPresetNames, "team");

    expect(selectedPresets(state)).toEqual([{ name: "team", dir: "/presets/team" }]);
  });

  it("resolves selected presets in selected order", () => {
    const state: TuiState = createInitialState([
      { name: "b", displayName: "B", description: "", source: "user", dir: "/presets/b" },
      { name: "a", displayName: "A", description: "", source: "user", dir: "/presets/a" },
    ]);

    state.selectedPresetNames = ["a", "b"];

    expect(selectedPresets(state)).toEqual([
      { name: "a", dir: "/presets/a" },
      { name: "b", dir: "/presets/b" },
    ]);
  });

  it("changes the review fingerprint when the preset order changes", () => {
    // Merge order decides which preset's extension args win, so a reordered selection must
    // invalidate a review that was generated for the old order.
    const state: TuiState = createInitialState([
      { name: "a", displayName: "A", description: "", source: "user", dir: "/presets/a" },
      { name: "b", displayName: "B", description: "", source: "user", dir: "/presets/b" },
    ]);

    state.selectedPresetNames = ["a", "b"];
    const reviewed = reviewFingerprint(state, "presetInstall");
    state.selectedPresetNames = ["b", "a"];

    expect(reviewFingerprint(state, "presetInstall")).not.toBe(reviewed);
  });

  it("presets-only screen blocks continue with no selected presets", () => {
    const state = createInitialState([
      { name: "team", displayName: "Team", description: "", source: "user", dir: "/presets/team" },
    ]);
    state.flow = "presetsOnly";
    state.screen = "presets";
    state.cursor = 2;

    expect(handleTuiKey(state, "enter")).toEqual({ type: "none" });
    expect(state.screen as string).toBe("presets");
    expect(state.notice).toContain("preset");
  });

  it("presets-only screen continues to plan without requiring a source", () => {
    const root = createTempRoot("ulis-tui-state-");
    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      const state = createInitialState([
        { name: "team", displayName: "Team", description: "", source: "user", dir: "/presets/team" },
      ]);
      state.screen = "presets";
      state.flow = "presetsOnly";
      state.selectedPresetNames = ["user:team"];
      state.cursor = 2;

      expect(handleTuiKey(state, "enter")).toEqual({ type: "none" });
      expect(state.screen as string).toBe("plan");
      expect(state.cursor).toBe(0);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("preset-only plan exposes validate and install without build-only", () => {
    const state = createInitialState([
      { name: "team", displayName: "Team", description: "", source: "user", dir: "/presets/team" },
    ]);
    state.flow = "presetsOnly";
    state.screen = "plan";
    state.selectedPresetNames = ["user:team"];

    expect(planItems(state).map((item) => item.id)).not.toContain("build");

    const originalNow = Date.now;
    let now = 5_000;
    Date.now = () => now;

    try {
      state.cursor = planCursor(state, "validate");
      expect(handleTuiKey(state, "enter")).toEqual({ type: "start", action: "presetValidate" });

      now += 45;
      state.cursor = planCursor(state, "install");
      expect(handleTuiKey(state, "enter")).toEqual({ type: "none" });
      expect(state.screen as string).toBe("presetInstallReview");
    } finally {
      Date.now = originalNow;
    }
  });

  it("preset picker groups user presets before bundled presets", () => {
    const state = createInitialState([
      { name: "react-web", displayName: "React", description: "", source: "bundled", dir: "/bundled/react-web" },
      { name: "team", displayName: "Team", description: "", source: "user", dir: "/user/team" },
    ]);
    state.screen = "presets";

    expect(visiblePresetChoices(state).map((preset) => preset.name)).toEqual(["team", "react-web"]);

    handleTuiKey(state, "enter");

    expect(state.selectedPresetNames).toEqual(["team"]);
  });

  it("normal preset layers keep project presets out of CLI-resolved selections", () => {
    const state = createInitialState([
      { name: "team", displayName: "Team", description: "", source: "project", dir: "/project/team" },
      { name: "team", displayName: "Team", description: "", source: "global", dir: "/global/team" },
    ]);
    state.selectedPresetNames = ["team"];

    expect(visiblePresetChoices(state).map((preset) => preset.source)).toEqual(["global"]);
    expect(selectedPresets(state)).toEqual([{ name: "team", dir: "/global/team" }]);
  });

  it("preset picker cycles source locations and resolves from the visible source", () => {
    const state = createInitialState([
      { name: "team", displayName: "Team", description: "", source: "project", dir: "/project/team" },
      { name: "team", displayName: "Team", description: "", source: "global", dir: "/global/team" },
    ]);
    state.screen = "presets";
    state.flow = "presetsOnly";

    expect(selectedPresets({ ...state, selectedPresetNames: ["project:team"] })).toEqual([
      { name: "team", dir: "/project/team" },
    ]);

    const originalNow = Date.now;
    let now = 1_000;
    Date.now = () => now;
    try {
      handleTuiKey(state, "space");
      expect(state.presetSourceMode).toBe("project");

      now += 45;
      handleTuiKey(state, "space");
      expect(state.presetSourceMode).toBe("global");

      state.selectedPresetNames = ["project:team"];
      expect(selectedPresets(state)).toEqual([]);

      state.selectedPresetNames = ["global:team"];
      expect(selectedPresets(state)).toEqual([{ name: "team", dir: "/global/team" }]);

      now += 45;
      handleTuiKey(state, "space");
      expect(state.presetSourceMode).toBe("bundled");

      now += 45;
      handleTuiKey(state, "space");
      expect(state.presetSourceMode).toBe("auto");
    } finally {
      Date.now = originalNow;
    }
  });

  it("opens and loads a custom preset directory from the source picker", () => {
    const cwd = createTempRoot("ulis-tui-state-");
    mkdirSync(join(cwd, "team-presets"));
    const state = createInitialState();
    state.screen = "presets";
    state.flow = "presetsOnly";
    state.presetSourceMode = "bundled";

    handleTuiKey(state, "enter");
    expect(state.screen as string).toBe("customPresetSource");
    expect(state.presetSourceMode as string).toBe("bundled");

    state.textInput = "./team-presets";
    const { effect } = handleCustomSourceTextInputKey(state, "enter", cwd);

    expect(effect).toEqual({ type: "loadCustomPresetSource", path: join(cwd, "team-presets") });
    expect(state.customPresetSource).toBe(join(cwd, "team-presets"));
    expect(state.presetSourceMode as string).toBe("custom");
    expect(state.screen).toBe("presets");
  });

  it("keeps the custom preset editor open when the directory does not exist", () => {
    const cwd = createTempRoot("ulis-tui-state-");
    const state = createInitialState();
    state.screen = "customPresetSource";
    state.textInput = "missing-presets";

    const result = handleCustomSourceTextInputKey(state, "enter", cwd);

    expect(result.effect).toEqual({ type: "none" });
    expect(state.screen).toBe("customPresetSource");
    expect(state.notice).toContain("does not exist");
  });

  it("only switches preset locations with Space", () => {
    const state = createInitialState();
    state.screen = "presets";
    state.flow = "presetsOnly";

    handleTuiKey(state, "enter");
    expect(state.presetSourceMode).toBe("auto");
    expect(state.screen as string).toBe("customPresetSource");

    handleCustomSourceTextInputKey(state, "escape");

    handleTuiKey(state, "x");
    expect(state.presetSourceMode).toBe("auto");

    handleTuiKey(state, "space");
    expect(state.presetSourceMode).toBe("project");
  });

  it("preset-only auto source checks project and global before bundled", () => {
    const state = createInitialState([
      { name: "bundled", displayName: "Bundled", description: "", source: "bundled", dir: "/bundled/preset" },
      { name: "project", displayName: "Project", description: "", source: "project", dir: "/project/preset" },
      { name: "global", displayName: "Global", description: "", source: "global", dir: "/global/preset" },
    ]);
    state.flow = "presetsOnly";

    expect(visiblePresetChoices(state).map((preset) => preset.source)).toEqual(["project", "global"]);
  });
});
