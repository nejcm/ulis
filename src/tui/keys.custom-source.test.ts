// handleCustomSourceTextInputKey / applyCustomSourceTextInputChange / appendTextInput /
// rememberCustomSource: the custom-source path text editor, paste handling, recent-path recall,
// and save/escape/enter routing. Includes "custom source TextInput handler does not dedupe rapid
// letter keys" — a dedupe-mechanics test, kept here because it exercises this same TextInput
// handler rather than the generic key-dispatch dedupe covered in key-codes.
import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { cleanupTempRoots, createTempRoot } from "../test-utils/fs.js";
import {
  appendTextInput,
  applyCustomSourceTextInputChange,
  handleCustomSourceTextInputKey,
  handleTuiKey,
} from "./keys.js";
import { rememberCustomSource } from "./selectors.js";
import { createInitialState } from "./state-model.js";

afterEach(() => {
  cleanupTempRoots();
});

describe("tui keys", () => {
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
    const root = createTempRoot("ulis-tui-state-");
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
    const root = createTempRoot("ulis-tui-state-");
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
});
