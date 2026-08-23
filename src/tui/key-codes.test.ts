// handleTuiKey: confirm-key aliases (return/CR/LF), quit/cancel routing, ANSI and named
// navigation-key aliases, the 35 ms rapid-repeat dedupe window, and generic backspace/delete back
// navigation. Includes "deduplicates rapid enter so presets back does not immediately open source"
// (a dedupe-mechanics test placed here rather than in presets) and "delete key navigates back
// outside custom source" (despite its name, it exercises the platforms screen, not custom source —
// a generic-back-nav case).
import { afterEach, describe, expect, it } from "bun:test";

import { cleanupTempRoots } from "../test-utils/fs.js";
import { handleTuiKey } from "./keys.js";
import { createInitialState } from "./state-model.js";

afterEach(() => {
  cleanupTempRoots();
});

describe("tui keys", () => {
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
