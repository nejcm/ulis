// handleTuiKey: the installReview and presetInstallReview screens — starting a run, toggling
// backup/prune/extensions/stay-local, remote-review re-prepare vs invalidate, blocking start with
// no platforms selected, back navigation, and the return-key alias and backspace cases for these
// two screens.
import { afterEach, describe, expect, it } from "bun:test";

import { cleanupTempRoots } from "../test-utils/fs.js";
import { handleTuiKey } from "./keys.js";
import { planItems } from "./selectors.js";
import { createInitialState, type PlanItemId, type TuiState } from "./state-model.js";

const planCursor = (state: TuiState, id: PlanItemId) => planItems(state).findIndex((item) => item.id === id);

afterEach(() => {
  cleanupTempRoots();
});

describe("tui keys", () => {
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

  it("accepts return alias as confirm in install review", () => {
    const state = createInitialState();
    state.screen = "installReview";
    state.cursor = 0;

    expect(handleTuiKey(state, "return")).toEqual({ type: "start", action: "install" });
  });

  it("backspace on installReview returns to plan install action", () => {
    const state = createInitialState();
    state.screen = "installReview";
    state.cursor = 0;

    handleTuiKey(state, "backspace");

    expect(state.screen as string).toBe("plan");
    expect(state.cursor).toBe(planCursor(state, "install"));
  });
});
