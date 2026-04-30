import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { PLATFORMS } from "../platforms.js";
import {
  createInitialState,
  handleTuiKey,
  planSource,
  selectedPresets,
  togglePresetSelection,
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
      state.cursor = 4;

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
      state.cursor = 6;

      expect(handleTuiKey(state, "enter")).toEqual({ type: "none" });
      expect(state.screen).toBe("installReview");
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
      state.cursor = 5;

      expect(handleTuiKey(state, "enter")).toEqual({ type: "none" });
      expect(state.screen).toBe("missingSource");
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

  it("platform screen can toggle all platforms off", () => {
    const state = createInitialState();
    state.screen = "platforms";
    state.cursor = 0;

    handleTuiKey(state, "enter");

    expect(state.platforms).toEqual([]);
    expect(PLATFORMS.length).toBeGreaterThan(0);
  });

  it("missingSource custom mode cursor=1 navigates to dashboard", () => {
    const state = createInitialState();
    state.screen = "missingSource";
    state.sourceMode = "custom";
    state.cursor = 1;

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("dashboard");
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

  it("missingSource non-custom cursor=2 navigates to dashboard", () => {
    const state = createInitialState();
    state.screen = "missingSource";
    state.sourceMode = "project";
    state.cursor = 2;

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("dashboard");
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

  it("installReview back navigates to dashboard", () => {
    const state = createInitialState();
    state.screen = "installReview";
    state.cursor = 3;

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("dashboard");
    expect(state.cursor).toBe(6);
  });

  it("customSource appends printable characters", () => {
    const state = createInitialState();
    state.screen = "customSource";
    state.textInput = "foo";

    handleTuiKey(state, "b");

    expect(state.textInput).toBe("foob");
  });

  it("customSource backspace removes last character", () => {
    const state = createInitialState();
    state.screen = "customSource";
    state.textInput = "foo";

    handleTuiKey(state, "backspace");

    expect(state.textInput).toBe("fo");
  });

  it("customSource escape returns to source screen at custom entry index", () => {
    const state = createInitialState();
    state.screen = "customSource";
    state.textInput = "some/path";

    handleTuiKey(state, "escape");

    expect(state.screen as string).toBe("source");
    expect(state.cursor).toBe(2);
  });

  it("customSource enter with empty input shows a notice", () => {
    const state = createInitialState();
    state.screen = "customSource";
    state.textInput = "  ";

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("customSource");
    expect(state.notice).toBeTruthy();
  });

  it("customSource enter with valid path saves and returns to dashboard", () => {
    const state = createInitialState();
    state.screen = "customSource";
    state.textInput = "/some/custom/path";

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("dashboard");
    expect(state.customSource).toBe("/some/custom/path");
    expect(state.sourceMode as string).toBe("custom");
    expect(state.destinationMode as string).toBe("project");
  });

  it("dashboard destination toggles with space key", () => {
    const state = createInitialState();
    state.cursor = 1;

    handleTuiKey(state, " ");

    expect(state.destinationMode).toBe("global");

    handleTuiKey(state, " ");

    expect(state.destinationMode).toBe("project");
  });

  it("dashboard destination toggles with named space key", () => {
    const state = createInitialState();
    state.cursor = 1;

    handleTuiKey(state, "space");

    expect(state.destinationMode).toBe("global");
  });

  it("dashboard destination toggles with x key", () => {
    const state = createInitialState();
    state.cursor = 1;

    handleTuiKey(state, "x");

    expect(state.destinationMode).toBe("global");
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

  it("deduplicates mixed up-arrow aliases from a single keypress", () => {
    const state = createInitialState();
    state.cursor = 2;

    handleTuiKey(state, "up");
    handleTuiKey(state, "arrowup");

    expect(state.cursor).toBe(1);
  });

  it("backspace on source screen returns to dashboard", () => {
    const state = createInitialState();
    state.screen = "source";
    state.cursor = 2;

    handleTuiKey(state, "backspace");

    expect(state.screen as string).toBe("dashboard");
    expect(state.cursor).toBe(0);
  });

  it("backspace on presets screen returns to dashboard", () => {
    const state = createInitialState();
    state.screen = "presets";
    state.cursor = 1;

    handleTuiKey(state, "backspace");

    expect(state.screen as string).toBe("dashboard");
    expect(state.cursor).toBe(0);
  });

  it("backspace on platforms screen returns to dashboard", () => {
    const state = createInitialState();
    state.screen = "platforms";
    state.cursor = 3;

    handleTuiKey(state, "backspace");

    expect(state.screen as string).toBe("dashboard");
    expect(state.cursor).toBe(0);
  });

  it("backspace on installReview returns to dashboard install action", () => {
    const state = createInitialState();
    state.screen = "installReview";
    state.cursor = 0;

    handleTuiKey(state, "backspace");

    expect(state.screen as string).toBe("dashboard");
    expect(state.cursor).toBe(6);
  });

  it("pendingAction is cleared when navigating away from result screen", () => {
    const state = createInitialState();
    state.screen = "result";
    state.pendingAction = "build";

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("dashboard");
    expect(state.pendingAction).toBeUndefined();
  });
});
