import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { PLATFORMS } from "../platforms.js";
import {
  appendTextInput,
  applyCustomSourceTextInputChange,
  createInitialState,
  handleCustomSourceTextInputKey,
  handleTuiKey,
  planItems,
  planSource,
  rememberCustomSource,
  selectedPresets,
  togglePresetSelection,
  visiblePresetChoices,
  type TuiState,
} from "./state.js";

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

describe("tui state", () => {
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
      globalInstall: false,
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
      state.cursor = 6;

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
      state.cursor = 8;

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
      state.cursor = 7;

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

  it("presets-only screen blocks continue with no selected presets", () => {
    const state = createInitialState([
      { name: "team", displayName: "Team", description: "", source: "user", dir: "/presets/team" },
    ]);
    state.flow = "presetsOnly";
    state.screen = "presets";
    state.cursor = 1;

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
      state.selectedPresetNames = ["team"];
      state.cursor = 1;

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
    state.selectedPresetNames = ["team"];

    expect(planItems(state)).not.toContain("Build only");

    const originalNow = Date.now;
    let now = 5_000;
    Date.now = () => now;

    try {
      state.cursor = 5;
      expect(handleTuiKey(state, "enter")).toEqual({ type: "start", action: "presetValidate" });

      now += 45;
      state.cursor = 6;
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

  it("installReview toggles backup with enter", () => {
    const state = createInitialState();
    state.screen = "installReview";
    state.cursor = 0;
    state.backup = true;

    handleTuiKey(state, "enter");

    expect(state.backup).toBe(false);
  });

  it("installReview toggles rebuild with space", () => {
    const state = createInitialState();
    state.screen = "installReview";
    state.cursor = 1;
    state.rebuild = true;

    handleTuiKey(state, " ");

    expect(state.rebuild).toBe(false);
  });

  it("installReview start returns start effect", () => {
    const state = createInitialState();
    state.screen = "installReview";
    state.cursor = 2;

    expect(handleTuiKey(state, "enter")).toEqual({ type: "start", action: "install" });
  });

  it("installReview back navigates to plan", () => {
    const state = createInitialState();
    state.screen = "installReview";
    state.cursor = 3;

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("plan");
    expect(state.cursor).toBe(planItems(state).indexOf("Install"));
  });

  it("presetInstallReview toggles extension installs with space", () => {
    const state = createInitialState();
    state.screen = "presetInstallReview";
    state.cursor = 1;
    state.presetInstallExtensions = true;

    handleTuiKey(state, " ");

    expect(state.presetInstallExtensions).toBe(false);
  });

  it("presetInstallReview start returns preset install effect", () => {
    const state = createInitialState();
    state.screen = "presetInstallReview";
    state.cursor = 2;

    expect(handleTuiKey(state, "enter")).toEqual({ type: "start", action: "presetInstall" });
  });

  it("presetInstallReview blocks start when no platforms are selected", () => {
    const state = createInitialState();
    state.screen = "presetInstallReview";
    state.cursor = 2;
    state.platforms = [];

    expect(handleTuiKey(state, "enter")).toEqual({ type: "none" });
    expect(state.notice).toContain("platform");
  });

  it("presetInstallReview back navigates to plan", () => {
    const state = createInitialState([
      { name: "team", displayName: "Team", description: "", source: "user", dir: "/presets/team" },
    ]);
    state.screen = "presetInstallReview";
    state.cursor = 3;

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("plan");
    expect(state.cursor).toBe(planItems(state).indexOf("Install"));
  });

  it("presetInstallReview back navigates to the preset-only install row", () => {
    const state = createInitialState([
      { name: "team", displayName: "Team", description: "", source: "user", dir: "/presets/team" },
    ]);
    state.flow = "presetsOnly";
    state.screen = "presetInstallReview";
    state.cursor = 3;

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("plan");
    expect(state.cursor).toBe(planItems(state).indexOf("Install"));
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

  it("customSource TextInput ctrl+v requests clipboard paste", () => {
    const state = createInitialState();
    state.screen = "customSource";

    expect(handleCustomSourceTextInputKey(state, "\u0016")).toEqual({
      effect: { type: "pasteClipboard" },
      preventDefault: true,
    });
  });

  it("customSource TextInput cmd+v requests clipboard paste", () => {
    const state = createInitialState();
    state.screen = "customSource";

    expect(handleCustomSourceTextInputKey(state, "cmd+v")).toEqual({
      effect: { type: "pasteClipboard" },
      preventDefault: true,
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

  it("accepts return alias as toggle in install review", () => {
    const state = createInitialState();
    state.screen = "installReview";
    state.cursor = 0;
    state.backup = true;

    handleTuiKey(state, "return");

    expect(state.backup).toBe(false);
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
    expect(state.cursor).toBe(planItems(state).indexOf("Install"));
  });

  it("pendingAction is cleared when navigating away from result screen", () => {
    const state = createInitialState();
    state.screen = "result";
    state.pendingAction = "build";

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("plan");
    expect(state.pendingAction).toBeUndefined();
  });
});
