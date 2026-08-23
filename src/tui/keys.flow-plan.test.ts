// handleTuiKey: source/destination defaults, plan-action routing (validate/install/build),
// missing-source recovery, the platform-toggle screen, plan-destination toggles, and result-screen
// cleanup. Includes "refuses a build against a remote source" (physically sits in the review block
// in the pre-split file, but is a plan-screen build-routing test, not a review-screen test).
import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { PLATFORMS } from "../platforms.js";
import { cleanupTempRoots, createTempRoot } from "../test-utils/fs.js";
import { handleTuiKey } from "./keys.js";
import { planItems, planSource } from "./selectors.js";
import { createInitialState, type PlanItemId, type TuiState } from "./state-model.js";

const planCursor = (state: TuiState, id: PlanItemId) => planItems(state).findIndex((item) => item.id === id);

afterEach(() => {
  cleanupTempRoots();
});

describe("tui keys", () => {
  it("defaults project source to a project destination", () => {
    const root = createTempRoot("ulis-tui-state-");
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
    const root = createTempRoot("ulis-tui-state-");
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
    const root = createTempRoot("ulis-tui-state-");
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
    const root = createTempRoot("ulis-tui-state-");
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
    const root = createTempRoot("ulis-tui-state-");
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

  it("pendingAction is cleared when navigating away from result screen", () => {
    const state = createInitialState();
    state.screen = "result";
    state.pendingAction = "build";

    handleTuiKey(state, "enter");

    expect(state.screen as string).toBe("plan");
    expect(state.pendingAction).toBeUndefined();
  });
});
