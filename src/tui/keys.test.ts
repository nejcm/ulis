import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { PLATFORMS } from "../platforms.js";
import {
  appendTextInput,
  applyCustomSourceTextInputChange,
  handleCustomSourceTextInputKey,
  handleTuiKey,
} from "./keys.js";
import { snapshotTuiPreferences } from "./preferences.js";
import {
  formatSourceMode,
  normalizeCustomSourceInput,
  planItems,
  planSource,
  remotePresetRef,
  rememberCustomSource,
  reviewFingerprint,
  selectedPresets,
  togglePresetSelection,
  visiblePresetChoices,
} from "./selectors.js";
import { createInitialState, type PlanItemId, type TuiState } from "./state-model.js";

const planCursor = (state: TuiState, id: PlanItemId) => planItems(state).findIndex((item) => item.id === id);

const tmpRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-tui-state-"));
  tmpRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("tui keys", () => {
  it("defaults project source to a project destination", () => {
    const root = createTempRoot();
    mkdirSync(join(root, ".ulis"));
    const state = createInitialState();

    expect(planSource(state, root, homedir())).toMatchObject({
      sourceDir: join(root, ".ulis"),
      destBase: root,
      sourceMode: "project",
      destinationMode: "project",
      sourceExists: true,
      globalInstall: undefined,
    });
  });

  it("selecting global source defaults install destination to global", () => {
    const state = createInitialState();
    state.screen = "source";
    state.cursor = 1;

    handleTuiKey(state, "enter");

    expect(state.sourceMode).toBe("global");
    expect(state.destinationMode).toBe("global");
  });

  it("custom source keeps destination explicit and project-local by default", () => {
    const root = createTempRoot();
    const custom = join(root, "custom-source");
    mkdirSync(custom);
    const state = createInitialState();
    state.sourceMode = "custom";
    state.customSource = custom;

    expect(planSource(state, root, homedir())).toMatchObject({
      sourceDir: custom,
      destBase: root,
      destinationMode: "project",
      sourceExists: true,
    });
  });

  it("starts validate when the selected source exists", () => {
    const root = createTempRoot();
    mkdirSync(join(root, ".ulis"));
    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      const state = createInitialState();
      state.screen = "plan";
      state.cursor = planCursor(state, "validate");

      expect(handleTuiKey(state, "enter")).toEqual({ type: "start", action: "validate" });
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("routes install through the review screen", () => {
    const root = createTempRoot();
    mkdirSync(join(root, ".ulis"));
    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      const state = createInitialState();
      state.screen = "plan";
      state.cursor = planCursor(state, "install");

      expect(handleTuiKey(state, "enter")).toEqual({ type: "none" });
      expect(state.screen as string).toBe("installReview");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("shows missing-source recovery before actions", () => {
    const root = createTempRoot();
    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      const state = createInitialState();
      state.screen = "plan";
      state.cursor = planCursor(state, "build");

      expect(handleTuiKey(state, "enter")).toEqual({ type: "none" });
      expect(state.screen as string).toBe("missingSource");
      expect(state.pendingAction).toBe("build");
    } finally {
      process.chdir(originalCwd);
    }
  });

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
    const root = createTempRoot();
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
    const cwd = createTempRoot();
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
    const cwd = createTempRoot();
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

  it("platform screen can toggle all platforms off", () => {
    const state = createInitialState();
    state.screen = "platforms";
    state.cursor = 0;

    handleTuiKey(state, "enter");

    expect(state.platforms).toEqual([]);
    expect(PLATFORMS.length).toBeGreaterThan(0);
  });

  it("missingSource custom mode cursor=1 navigates to plan", () => {
    const state = createInitialState();
    state.screen = "missingSource";
    state.sourceMode = "custom";
    state.cursor = 1;

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("plan");
    expect(state.cursor).toBe(0);
  });

  it("missingSource custom mode cursor=0 navigates to source selection", () => {
    const state = createInitialState();
    state.screen = "missingSource";
    state.sourceMode = "custom";
    state.cursor = 0;

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("source");
    expect(state.cursor).toBe(0);
  });

  it("missingSource non-custom cursor=2 navigates to plan", () => {
    const state = createInitialState();
    state.screen = "missingSource";
    state.sourceMode = "project";
    state.cursor = 2;

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("plan");
  });

  it("missingSource non-custom cursor=1 navigates to source selection", () => {
    const state = createInitialState();
    state.screen = "missingSource";
    state.sourceMode = "project";
    state.cursor = 1;

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("source");
    expect(state.cursor).toBe(0);
  });

  it("missingSource non-custom cursor=0 returns initSource effect", () => {
    const state = createInitialState();
    state.screen = "missingSource";
    state.sourceMode = "project";
    state.cursor = 0;

    expect(handleTuiKey(state, "enter")).toEqual({ type: "initSource" });
  });

  it("installReview start returns start effect", () => {
    const state = createInitialState();
    state.screen = "installReview";
    state.cursor = 0;

    expect(handleTuiKey(state, "enter")).toEqual({ type: "start", action: "install" });
  });

  it.each([
    [0, " "],
    [0, "space"],
    [0, "x"],
    [1, " "],
    [1, "space"],
    [1, "x"],
  ] as const)("installReview action row %i ignores toggle key %j", (cursor, key) => {
    const state = createInitialState();
    state.screen = "installReview";
    state.cursor = cursor;

    expect(handleTuiKey(state, key)).toEqual({ type: "none" });
    expect(state.screen).toBe("installReview");
  });

  it("installReview back navigates to plan", () => {
    const state = createInitialState();
    state.screen = "installReview";
    state.cursor = 1;

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("plan");
    expect(state.cursor).toBe(planCursor(state, "install"));
  });

  it("clears remote review display when leaving review or resetting the flow", () => {
    const reviewState = createInitialState();
    reviewState.screen = "installReview";
    reviewState.remoteCommands = ["bunx -- remote-extension"];
    reviewState.remoteCommandSource = "https://github.com/o/remote";
    const reviewEffect = handleTuiKey(reviewState, "backspace");

    const flowState = createInitialState();
    flowState.screen = "flow";
    flowState.cursor = 0;
    flowState.remoteCommands = ["bunx -- remote-extension"];
    flowState.remoteCommandSource = "https://github.com/o/remote";
    const flowEffect = handleTuiKey(flowState, "enter");

    expect([
      { effect: reviewEffect, commands: reviewState.remoteCommands, source: reviewState.remoteCommandSource },
      { effect: flowEffect, commands: flowState.remoteCommands, source: flowState.remoteCommandSource },
    ]).toEqual([
      { effect: { type: "none", discardRemoteReview: true }, commands: [], source: "" },
      { effect: { type: "none", discardRemoteReview: true }, commands: [], source: "" },
    ]);
  });

  it("presetInstallReview toggles extension installs with space", () => {
    const state = createInitialState();
    state.screen = "presetInstallReview";
    state.cursor = 2;
    state.presetInstallExtensions = true;

    handleTuiKey(state, " ");

    expect(state.presetInstallExtensions).toBe(false);
  });

  it.each([
    [0, "backup"],
    [1, "prune"],
    [2, "presetInstallExtensions"],
  ] as const)("presetInstallReview row %i toggles with space and x", (cursor, field) => {
    for (const key of [" ", "space", "x"]) {
      const state = createInitialState();
      state.screen = "presetInstallReview";
      state.cursor = cursor;
      const before = state[field];

      expect(handleTuiKey(state, key)).toEqual({ type: "none" });
      expect(state[field]).toBe(!before);
    }
  });

  it("presetInstallReview toggles re-prepare a remote review instead of invalidating it", () => {
    const state = createInitialState();
    state.flow = "presetsOnly";
    state.presetSourceMode = "custom";
    state.customPresetSource = "https://github.com/o/r";
    state.screen = "presetInstallReview";
    state.cursor = 0;

    // Backup is part of the review fingerprint, so the review has to be regenerated with it.
    expect(handleTuiKey(state, " ")).toEqual({ type: "prepareRemoteInstall", action: "presetInstall" });
    expect(state.backup).toBe(false);
  });

  it("presetInstallReview toggles stay local when nothing is remote", () => {
    const state = createInitialState();
    state.screen = "presetInstallReview";
    state.cursor = 0;

    expect(handleTuiKey(state, " ")).toEqual({ type: "none" });
    expect(state.backup).toBe(false);
  });

  it("refuses a build against a remote source instead of spawning one", () => {
    const state = createInitialState();
    state.screen = "plan";
    state.sourceMode = "custom";
    state.customSource = "https://user:s3cret@github.com/o/r";
    state.cursor = planCursor(state, "build");

    // The child would only ever receive the credentialed URL and print `build`'s own refusal.
    expect(handleTuiKey(state, "enter")).toEqual({ type: "none" });
    expect(state.notice).toContain("remote source");
    expect(state.screen).toBe("plan");
  });

  it("presetInstallReview start returns preset install effect", () => {
    const state = createInitialState();
    state.screen = "presetInstallReview";
    state.cursor = 3;

    expect(handleTuiKey(state, "enter")).toEqual({ type: "start", action: "presetInstall" });
  });

  it.each([
    [3, " "],
    [3, "space"],
    [3, "x"],
    [4, " "],
    [4, "space"],
    [4, "x"],
  ] as const)("presetInstallReview action row %i ignores toggle key %j", (cursor, key) => {
    const state = createInitialState();
    state.screen = "presetInstallReview";
    state.cursor = cursor;

    expect(handleTuiKey(state, key)).toEqual({ type: "none" });
    expect(state.screen).toBe("presetInstallReview");
  });

  it("presetInstallReview blocks start when no platforms are selected", () => {
    const state = createInitialState();
    state.screen = "presetInstallReview";
    state.cursor = 3;
    state.platforms = [];

    expect(handleTuiKey(state, "enter")).toEqual({ type: "none" });
    expect(state.notice).toContain("platform");
  });

  it("presetInstallReview back navigates to plan", () => {
    const state = createInitialState([
      { name: "team", displayName: "Team", description: "", source: "user", dir: "/presets/team" },
    ]);
    state.screen = "presetInstallReview";
    state.cursor = 4;

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("plan");
    expect(state.cursor).toBe(planCursor(state, "install"));
  });

  it("presetInstallReview back navigates to the preset-only install row", () => {
    const state = createInitialState([
      { name: "team", displayName: "Team", description: "", source: "user", dir: "/presets/team" },
    ]);
    state.flow = "presetsOnly";
    state.screen = "presetInstallReview";
    state.cursor = 4;

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("plan");
    expect(state.cursor).toBe(planCursor(state, "install"));
  });

  it("customSource path value syncs like TextInput onChange", () => {
    const state = createInitialState();
    state.screen = "customSource";
    state.textInput = "foo";

    applyCustomSourceTextInputChange(state, "foob");

    expect(state.textInput).toBe("foob");
  });

  it("customSource appendTextInput still appends pasted text", () => {
    const state = createInitialState();
    state.screen = "customSource";
    state.textInput = "";

    expect(appendTextInput(state, "C:\\Work\\Personal\\ulis\\.ulis")).toBe(true);

    expect(state.textInput).toBe("C:\\Work\\Personal\\ulis\\.ulis");
  });

  it("customSource appendTextInput strips bracketed paste markers", () => {
    const state = createInitialState();
    state.screen = "customSource";
    state.textInput = "";

    expect(appendTextInput(state, "\u001b[200~C:\\Work\\Personal\\ulis\\.ulis\u001b[201~")).toBe(true);

    expect(state.textInput).toBe("C:\\Work\\Personal\\ulis\\.ulis");
  });

  it("customSource TextInput leaves ctrl+v to the terminal", () => {
    const state = createInitialState();
    state.screen = "customSource";

    expect(handleCustomSourceTextInputKey(state, "\u0016")).toEqual({
      effect: { type: "none" },
      preventDefault: false,
    });
  });

  it("customSource TextInput leaves cmd+v to the terminal", () => {
    const state = createInitialState();
    state.screen = "customSource";

    expect(handleCustomSourceTextInputKey(state, "cmd+v")).toEqual({
      effect: { type: "none" },
      preventDefault: false,
    });
  });

  it("customSource escape returns to source screen at custom entry index", () => {
    const state = createInitialState();
    state.screen = "customSource";
    state.textInput = "some/path";

    const result = handleCustomSourceTextInputKey(state, "escape");

    expect(result.preventDefault).toBe(true);
    expect(state.screen as string).toBe("source");
    expect(state.cursor).toBe(2);
  });

  it("customSource enter with empty input shows a notice", () => {
    const state = createInitialState();
    state.screen = "customSource";
    state.textInput = "  ";

    const result = handleCustomSourceTextInputKey(state, "enter");

    expect(result.preventDefault).toBe(true);
    expect(state.screen as string).toBe("customSource");
    expect(state.notice).toBeTruthy();
  });

  it("customSource enter with valid path saves and returns to plan", () => {
    const root = createTempRoot();
    mkdirSync(join(root, ".ulis"));
    const state = createInitialState();
    state.screen = "customSource";
    state.textInput = root;

    const result = handleCustomSourceTextInputKey(state, "enter");

    expect(result.preventDefault).toBe(true);
    expect(state.screen as string).toBe("plan");
    expect(state.customSource).toBe(join(root, ".ulis"));
    expect(state.recentCustomSources).toEqual([join(root, ".ulis")]);
    expect(state.sourceMode as string).toBe("custom");
    expect(state.destinationMode as string).toBe("project");
  });

  it("customSource enter on a recent path selects and saves it", () => {
    const root = createTempRoot();
    const recentA = join(root, "recent-a", ".ulis");
    const recentB = join(root, "recent-b", ".ulis");
    const state = createInitialState();
    state.screen = "customSource";
    state.textInput = "";
    state.recentCustomSources = [recentA, recentB];
    state.cursor = 2;

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("plan");
    expect(state.customSource).toBe(recentB);
    expect(state.recentCustomSources).toEqual([recentB, recentA]);
  });

  it("opening custom source keeps the saved custom source in recent inputs", () => {
    const state = createInitialState();
    state.screen = "source";
    state.cursor = 2;
    state.customSource = "/saved/source";
    state.recentCustomSources = ["/older/source"];

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("customSource");
    expect(state.textInput).toBe("/saved/source");
    expect(state.recentCustomSources).toEqual(["/saved/source", "/older/source"]);
  });

  it("customSource arrow keys move through recent paths from the path row", () => {
    const state = createInitialState();
    state.screen = "customSource";
    state.recentCustomSources = ["/recent/a", "/recent/b"];

    const result = handleCustomSourceTextInputKey(state, "down");

    expect(result.preventDefault).toBe(true);
    expect(state.cursor).toBe(1);
  });

  it("customSource allows printable shortcut keys in the path", () => {
    const state = createInitialState();
    state.screen = "customSource";
    state.recentCustomSources = ["/recent/a"];

    for (const key of ["j", "k", "x", "q", " ", "space"]) {
      expect(handleCustomSourceTextInputKey(state, key)).toEqual({
        effect: { type: "none" },
        preventDefault: false,
      });
    }
    expect(state.cursor).toBe(0);
  });

  it("rememberCustomSource keeps the three most recent unique values", () => {
    expect(rememberCustomSource(["/b", "/c", "/d"], "/a")).toEqual(["/a", "/b", "/c"]);
    expect(rememberCustomSource(["/a", "/b", "/c"], "/b")).toEqual(["/b", "/a", "/c"]);
  });

  it("plan destination toggles with space key", () => {
    const state = createInitialState();
    state.screen = "plan";
    state.cursor = 3;
    const originalNow = Date.now;
    let now = 4_000;
    Date.now = () => now;
    try {
      handleTuiKey(state, " ");

      expect(state.destinationMode).toBe("global");

      now += 45;
      handleTuiKey(state, " ");

      expect(state.destinationMode).toBe("project");
    } finally {
      Date.now = originalNow;
    }
  });

  it("plan destination toggles with named space key", () => {
    const state = createInitialState();
    state.screen = "plan";
    state.cursor = 3;

    handleTuiKey(state, "space");

    expect(state.destinationMode).toBe("global");
  });

  it("plan destination toggles with x key", () => {
    const state = createInitialState();
    state.screen = "plan";
    state.cursor = 3;

    handleTuiKey(state, "x");

    expect(state.destinationMode).toBe("global");
  });

  it("accepts return key as confirm on Linux terminals", () => {
    const state = createInitialState();
    state.cursor = 1;

    handleTuiKey(state, "return");

    expect(state.destinationMode).toBe("global");
  });

  it("accepts carriage return character as confirm", () => {
    const state = createInitialState();
    state.cursor = 1;

    handleTuiKey(state, "\r");

    expect(state.destinationMode).toBe("global");
  });

  it("accepts newline character as confirm", () => {
    const state = createInitialState();
    state.cursor = 1;

    handleTuiKey(state, "\n");

    expect(state.destinationMode).toBe("global");
  });

  it("deduplicates rapid enter so presets back does not immediately open source", () => {
    const state = createInitialState([
      { name: "team", displayName: "Team", description: "", source: "user", dir: "/p" },
    ]);
    state.screen = "presets";
    state.cursor = 1; // Back to plan
    const originalNow = Date.now;
    let now = 1_000;
    Date.now = () => now;
    try {
      handleTuiKey(state, "enter");
      now += 5;
      handleTuiKey(state, "enter");
    } finally {
      Date.now = originalNow;
    }

    expect(state.screen as string).toBe("plan");
    expect(state.cursor).toBe(0);
  });

  it("deduplicates rapid toggle key events", () => {
    const state = createInitialState();
    state.screen = "plan";
    state.cursor = 3;
    const originalNow = Date.now;
    let now = 2_000;
    Date.now = () => now;
    try {
      handleTuiKey(state, "x");
      now += 5;
      handleTuiKey(state, "x");
    } finally {
      Date.now = originalNow;
    }

    expect(state.destinationMode).toBe("global");
  });

  it("custom source TextInput handler does not dedupe rapid letter keys", () => {
    const state = createInitialState();
    state.screen = "customSource";
    const originalNow = Date.now;
    let now = 3_000;
    Date.now = () => now;
    try {
      expect(handleCustomSourceTextInputKey(state, "l").preventDefault).toBe(false);
      now += 5;
      expect(handleCustomSourceTextInputKey(state, "l").preventDefault).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });

  it("accepts return alias as confirm in install review", () => {
    const state = createInitialState();
    state.screen = "installReview";
    state.cursor = 0;

    expect(handleTuiKey(state, "return")).toEqual({ type: "start", action: "install" });
  });

  it("delete key navigates back outside custom source", () => {
    const state = createInitialState();
    state.screen = "platforms";
    state.cursor = 2;

    handleTuiKey(state, "delete");

    expect(state.screen as string).toBe("plan");
    expect(state.cursor).toBe(0);
  });

  it("normalizes control-c character to quit", () => {
    const state = createInitialState();

    expect(handleTuiKey(state, "\u0003")).toEqual({ type: "exit", code: 0 });
  });

  it("q stops the running workflow instead of quitting", () => {
    const state = createInitialState();
    state.screen = "running";

    expect(handleTuiKey(state, "q")).toEqual({ type: "cancelRunning" });
  });

  it("normalizes ANSI down sequence to move cursor", () => {
    const state = createInitialState();

    handleTuiKey(state, "\u001b[B");

    expect(state.cursor).toBe(1);
  });

  it("deduplicates mixed down-arrow aliases from a single keypress", () => {
    const state = createInitialState();
    state.cursor = 0;

    handleTuiKey(state, "down");
    handleTuiKey(state, "arrowdown");

    expect(state.cursor).toBe(1);
  });

  it("deduplicates repeated down key events from a single keypress", () => {
    const state = createInitialState();
    state.cursor = 0;

    handleTuiKey(state, "down");
    handleTuiKey(state, "down");

    expect(state.cursor).toBe(1);
  });

  it("allows repeated down key events outside dedupe window", () => {
    const state = createInitialState();
    state.cursor = 0;
    const originalNow = Date.now;
    let now = 1_000;
    Date.now = () => now;
    try {
      handleTuiKey(state, "down");
      now += 45;
      handleTuiKey(state, "down");
    } finally {
      Date.now = originalNow;
    }

    expect(state.cursor).toBe(2);
  });

  it("does not dedupe opposite navigation direction", () => {
    const state = createInitialState();
    state.cursor = 1;
    const originalNow = Date.now;
    let now = 1_000;
    Date.now = () => now;
    try {
      handleTuiKey(state, "down");
      now += 5;
      handleTuiKey(state, "up");
    } finally {
      Date.now = originalNow;
    }

    expect(state.cursor).toBe(1);
  });

  it("deduplicates mixed up-arrow aliases from a single keypress", () => {
    const state = createInitialState();
    state.cursor = 2;

    handleTuiKey(state, "up");
    handleTuiKey(state, "arrowup");

    expect(state.cursor).toBe(1);
  });

  it("backspace on source screen returns to plan", () => {
    const state = createInitialState();
    state.screen = "source";
    state.cursor = 2;

    handleTuiKey(state, "backspace");

    expect(state.screen as string).toBe("plan");
    expect(state.cursor).toBe(0);
  });

  it("backspace on presets screen returns to plan", () => {
    const state = createInitialState();
    state.screen = "presets";
    state.cursor = 1;

    handleTuiKey(state, "backspace");

    expect(state.screen as string).toBe("plan");
    expect(state.cursor).toBe(0);
  });

  it("backspace on platforms screen returns to plan", () => {
    const state = createInitialState();
    state.screen = "platforms";
    state.cursor = 3;

    handleTuiKey(state, "backspace");

    expect(state.screen as string).toBe("plan");
    expect(state.cursor).toBe(0);
  });

  it("backspace on installReview returns to plan install action", () => {
    const state = createInitialState();
    state.screen = "installReview";
    state.cursor = 0;

    handleTuiKey(state, "backspace");

    expect(state.screen as string).toBe("plan");
    expect(state.cursor).toBe(planCursor(state, "install"));
  });

  it("pendingAction is cleared when navigating away from result screen", () => {
    const state = createInitialState();
    state.screen = "result";
    state.pendingAction = "build";

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("plan");
    expect(state.pendingAction).toBeUndefined();
  });

  it("suppresses a duplicate key event inside the 35 ms debounce window", () => {
    const state = createInitialState();
    const originalNow = Date.now;
    Date.now = () => 3_000;
    try {
      handleTuiKey(state, "down");
      expect(state.cursor).toBe(1);

      // Same key again inside the window: `isDuplicateKeyEvent` short-circuits before dispatch, so
      // the cursor does not move a second time.
      expect(handleTuiKey(state, "down")).toEqual({ type: "none" });
      expect(state.cursor).toBe(1);

      // A fresh state clears the tracker (createInitialState resets it), so the same key is
      // handled normally again rather than staying suppressed forever.
      const freshState = createInitialState();
      expect(handleTuiKey(freshState, "down")).toEqual({ type: "none" });
      expect(freshState.cursor).toBe(1);
    } finally {
      Date.now = originalNow;
    }
  });
});

describe("remote sources", () => {
  const url = "https://github.com/o/r";

  it("keeps a remote custom source as a URL rather than resolving it as a path", () => {
    expect(normalizeCustomSourceInput(url, "/project")).toBe(url);
  });

  it("plans a remote source without touching the filesystem", () => {
    const state = createInitialState();
    state.sourceMode = "custom";
    state.customSource = url;

    // `sourceExists` must be true without cloning, or the TUI diverts to the missingSource screen.
    expect(planSource(state, "/project", "/home/u")).toMatchObject({
      sourceDir: url,
      destBase: "/project",
      remote: true,
      sourceExists: true,
    });
  });

  it("installs a remote source to home when the destination is global", () => {
    const state = createInitialState();
    state.sourceMode = "custom";
    state.customSource = url;
    state.destinationMode = "global";

    expect(planSource(state, "/project", "/home/u")).toMatchObject({ destBase: "/home/u", remote: true });
  });

  it("marks a local custom source as not remote", () => {
    const state = createInitialState();
    state.sourceMode = "custom";
    state.customSource = "./example";

    expect(planSource(state, "/project", "/home/u").remote).toBe(false);
  });

  it("treats a remote preset location as a ref, not a directory to scan", () => {
    const state = createInitialState();
    state.flow = "presetsOnly";
    state.screen = "customPresetSource";
    state.cursor = 0;
    state.textInput = url;

    const { effect } = handleCustomSourceTextInputKey(state, "enter", "/project");

    // No scan effect: there is nothing to list until it is cloned.
    expect(effect).toEqual({ type: "none" });
    expect(state.customPresetSource).toBe(url);
    expect(state.presetSourceMode as string).toBe("custom");
    expect(state.notice).toBe("");
    expect(state.screen as string).toBe("presets");
    expect(remotePresetRef(state)).toBe(url);
  });

  it("does not leak a presets-only remote ref into another flow", () => {
    const state = createInitialState();
    state.flow = "presetsOnly";
    state.presetSourceMode = "custom";
    state.customPresetSource = "https://github.com/o/preset";
    expect(remotePresetRef(state)).toBe("https://github.com/o/preset");

    // Switching to the custom-base flow must not drag the preset URL along with it.
    handleTuiKey(state, "escape");
    state.flow = "custom";
    expect(remotePresetRef(state)).toBeUndefined();
  });

  it("clears a stale preset location when the flow changes", () => {
    const state = createInitialState();
    state.screen = "flow";
    state.flow = "presetsOnly";
    state.presetSourceMode = "custom";
    state.customPresetSource = "https://github.com/o/preset";

    // Pick "Use custom source" from the flow screen.
    state.cursor = 2;
    handleTuiKey(state, "enter");

    expect(state.customPresetSource).toBe("");
    expect(remotePresetRef(state)).toBeUndefined();
  });

  it("reports no remote preset ref for a local directory", () => {
    const state = createInitialState();
    state.flow = "presetsOnly";
    state.presetSourceMode = "custom";
    state.customPresetSource = "/project/team-presets";

    expect(remotePresetRef(state)).toBeUndefined();
  });

  it("redacts credentials when displaying a pasted URL", () => {
    const credentialed = "https://user:s3cret@github.com/o/r";
    const rendered = formatSourceMode("custom", credentialed);

    expect(rendered).not.toContain("s3cret");
    expect(rendered).toContain("https://github.com/o/r");
  });
});

describe("credential persistence", () => {
  const credentialed = "https://user:s3cret@github.com/o/r";

  it("redacts credentials before remembering a recent source", () => {
    const recents = rememberCustomSource([], credentialed);

    expect(recents).toEqual(["https://github.com/o/r"]);
    expect(recents.join()).not.toContain("s3cret");
  });

  it("redacts credentials before they reach the preferences snapshot", () => {
    const state = createInitialState();
    state.flow = "custom";
    state.sourceMode = "custom";
    state.customSource = credentialed;

    const snapshot = snapshotTuiPreferences(state);

    expect(JSON.stringify(snapshot)).not.toContain("s3cret");
    expect(JSON.stringify(snapshot)).toContain("https://github.com/o/r");
  });

  it("redacts a credentialed preset ref before persisting it", () => {
    const state = createInitialState();
    state.flow = "presetsOnly";
    state.presetSourceMode = "custom";
    state.customPresetSource = credentialed;

    expect(JSON.stringify(snapshotTuiPreferences(state))).not.toContain("s3cret");
  });

  it("keeps the credentialed value in memory for the clone", () => {
    const state = createInitialState();
    state.flow = "custom";
    state.sourceMode = "custom";
    state.customSource = credentialed;

    snapshotTuiPreferences(state);

    // Persisting must not mutate what the clone will use.
    expect(state.customSource).toBe(credentialed);
    expect(planSource(state, "/project", "/home/u").sourceDir).toBe(credentialed);
  });
});

// 3.2: nothing checked that plan item ids are unique within a flow. `planItemCursor` (keys.ts)
// takes the first match on a duplicate, and the exhaustive `assertNeverPlanItemId` switch stays
// happy either way, so a duplicate id would silently misroute cursor navigation with no type error.
describe("planItems", () => {
  it("has unique ids for the dashboard flow", () => {
    const state = createInitialState();
    state.flow = "project";
    const items = planItems(state);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it("has unique ids for the presets-only flow", () => {
    const state = createInitialState();
    state.flow = "presetsOnly";
    const items = planItems(state);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });
});
