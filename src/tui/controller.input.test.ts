// TuiController input handling: keyboard navigation/quit, mouse clicks and wheel scrolling, and
// the custom-source text editor (clipboard paste, preset loading from a submitted directory).
import { afterEach, describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { cleanupTempRoots } from "../test-utils/fs.js";
import { cleanupControllerRenderers, createHarness, KEY_DELAY_MS, preferencesPath } from "./test-support.js";

afterEach(() => {
  cleanupControllerRenderers();
  cleanupTempRoots();
});

describe("TUI keyboard control", () => {
  it("moves the cursor with arrows and with j/k", async () => {
    const harness = await createHarness();
    expect(harness.controller.state.cursor).toBe(0);

    await harness.press("ARROW_DOWN");
    expect(harness.controller.state.cursor).toBe(1);

    await harness.press("j");
    expect(harness.controller.state.cursor).toBe(2);

    await harness.press("k", "ARROW_UP");
    expect(harness.controller.state.cursor).toBe(0);
  });

  it("enters a flow and returns with backspace", async () => {
    const harness = await createHarness();
    await harness.press("RETURN");
    expect(harness.controller.state.screen).toBe("plan");

    await harness.press("BACKSPACE");
    expect(harness.controller.state.screen).not.toBe("plan");
  });

  it("quits with q", async () => {
    const harness = await createHarness();
    await harness.press("q");
    expect(harness.exitCodes).toEqual([0]);
  });

  it("quits with Ctrl+C even while the path editor holds focus", async () => {
    const harness = await createHarness();
    harness.controller.state.screen = "customSource";
    harness.controller.state.cursor = 0;
    harness.controller.render();
    await harness.renderOnce();

    harness.mockInput.pressCtrlC();
    expect(harness.exitCodes).toEqual([0]);
  });
});

describe("TUI mouse control", () => {
  it("keeps non-review Enter behavior after wheel scrolling", async () => {
    const harness = await createHarness(80, 20);
    await harness.frame();
    for (let index = 0; index < 5; index += 1) await harness.mockMouse.scroll(20, 12, "down");
    await harness.renderOnce();

    await harness.press("RETURN");
    expect(harness.controller.state.screen).toBe("plan");
  });

  it("activates the row under a click", async () => {
    const harness = await createHarness();
    const frame = await harness.frame();
    const row = frame.split("\n").findIndex((line) => line.includes("Update global configs"));
    expect(row).toBeGreaterThan(0);

    await harness.mockMouse.click(6, row);
    harness.controller.render();
    await harness.renderOnce();
    expect(harness.controller.state.screen).toBe("plan");
    expect(harness.controller.state.sourceMode).toBe("global");
  });

  it("scrolls a pane with the wheel without changing the cursor", async () => {
    const harness = await createHarness(80, 20);
    await harness.press("RETURN");
    const before = harness.controller.state.cursor;

    await harness.mockMouse.scroll(20, 10, "down");
    await harness.renderOnce();
    expect(harness.controller.state.cursor).toBe(before);

    await harness.press("RETURN");
    expect(harness.controller.state.screen).toBe("presets");
  });
});

describe("TUI text input", () => {
  it("edits the custom source path and pastes clipboard text", async () => {
    const harness = await createHarness(100, 30, { readClipboard: () => "/pasted/path" });
    // Start -> "Use custom source" is the third option.
    await harness.press("ARROW_DOWN", "ARROW_DOWN", "RETURN");
    expect(harness.controller.state.screen).toBe("customSource");

    await harness.mockInput.typeText("./abc", KEY_DELAY_MS);
    harness.controller.render();
    await harness.renderOnce();
    expect(harness.controller.state.textInput).toContain("./abc");

    harness.controller.state.textInput = "";
    harness.controller.render();
    await harness.renderOnce();
    harness.mockInput.pressKey("v", { ctrl: true });
    harness.controller.render();
    await harness.renderOnce();
    expect(harness.controller.state.textInput).toBe("/pasted/path");
  });

  it("loads presets from the submitted custom directory", async () => {
    const requestedRoots: Array<string | undefined> = [];
    const harness = await createHarness(100, 30, {
      listPresets: (options) => {
        requestedRoots.push(options?.customRoot);
        return options?.customRoot
          ? [
              {
                name: "team",
                displayName: "Team",
                description: "",
                source: "custom",
                dir: join(options.customRoot, "team"),
              },
            ]
          : [];
      },
    });

    await harness.controller.handleEffect({ type: "loadCustomPresetSource", path: "C:\\presets" });

    expect(requestedRoots).toContain("C:\\presets");
    expect(harness.controller.state.availablePresets).toContainEqual(
      expect.objectContaining({ name: "team", source: "custom" }),
    );
  });

  it("restores a saved custom preset source and selection when entering the preset-only flow", async () => {
    const filePath = preferencesPath();
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 2,
        scopes: {
          presetsOnly: {
            customPresetSource: "C:\\presets",
            presetSourceMode: "custom",
            selectedPresetNames: ["custom:team", "custom:removed"],
          },
        },
      }),
    );
    const requestedRoots: Array<string | undefined> = [];
    const harness = await createHarness(100, 30, {
      preferencesPath: filePath,
      listPresets: (options) => {
        requestedRoots.push(options?.customRoot);
        return options?.customRoot
          ? [
              {
                name: "team",
                displayName: "Team",
                description: "",
                source: "custom",
                dir: join(options.customRoot, "team"),
              },
            ]
          : [];
      },
    });

    await harness.press("ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "RETURN");

    expect(requestedRoots).toContain("C:\\presets");
    expect(harness.controller.state.presetSourceMode).toBe("custom");
    expect(harness.controller.state.customPresetSource).toBe("C:\\presets");
    expect(harness.controller.state.selectedPresetNames).toEqual(["custom:team"]);
  });

  it("reports an empty custom preset directory", async () => {
    const harness = await createHarness();
    harness.controller.state.flow = "presetsOnly";
    harness.controller.state.presetSourceMode = "custom";
    harness.controller.state.customPresetSource = "C:\\empty-presets";

    await harness.controller.handleEffect({ type: "loadCustomPresetSource", path: "C:\\empty-presets" });

    expect(harness.controller.state.notice).toContain("No presets found");
    expect(harness.controller.state.notice).toContain("C:\\empty-presets");
  });
});
