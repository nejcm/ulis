import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";

import { TuiController, type TuiControllerOptions } from "./controller.js";
import { MIN_COLUMNS, MIN_ROWS, SPLIT_COLUMNS } from "./view.js";

/** Comfortably above `state.ts`'s 35 ms duplicate-key window. */
const KEY_DELAY_MS = 60;

const tmpRoots: string[] = [];
const activeRenderers: { destroy: () => void }[] = [];

function preferencesPath(): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-tui-controller-"));
  tmpRoots.push(root);
  return join(root, ".ulis-tui.json");
}

interface Harness extends TestRendererSetup {
  controller: TuiController;
  exitCodes: number[];
  frame: () => Promise<string>;
  press: (...keys: string[]) => Promise<void>;
}

async function createHarness(
  width = 100,
  height = 30,
  options: Omit<TuiControllerOptions, "exit"> = {},
): Promise<Harness> {
  const setup = await createTestRenderer({ width, height });
  activeRenderers.push(setup.renderer);
  const exitCodes: number[] = [];
  const controller = new TuiController(setup.renderer, {
    exit: (code) => exitCodes.push(code),
    listPresets: () => [],
    preferencesPath: options.preferencesPath ?? preferencesPath(),
    ...options,
  });
  controller.render();
  await setup.renderOnce();

  const frame = async () => {
    controller.render();
    await setup.renderOnce();
    return setup.captureCharFrame();
  };
  const press = async (...keys: string[]) => {
    for (const key of keys) await setup.mockInput.pressKeys([key], KEY_DELAY_MS);
    controller.render();
    await setup.renderOnce();
  };

  return { ...setup, controller, exitCodes, frame, press };
}

afterEach(() => {
  // Each test renderer registers process-level listeners; drop them so long runs
  // do not trip Node's max-listener warning.
  for (const renderer of activeRenderers.splice(0)) renderer.destroy();
  for (const root of tmpRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("TUI layout", () => {
  it("renders the start screen with its options and control hints", async () => {
    const harness = await createHarness();
    const frame = await harness.frame();

    expect(frame).toContain(" _   _ _     ___ ____");
    expect(frame).toContain("Update this project");
    expect(frame).toContain("Update global configs");
    expect(frame).toContain("Enter: select");
    expect(frame).toContain("q: quit");
  });

  it("shows plan panes side by side on wide terminals", async () => {
    const harness = await createHarness(SPLIT_COLUMNS + 4, 30);
    await harness.press("ARROW_DOWN", "RETURN");
    const frame = await harness.frame();

    const splitLine = frame.split("\n").find((line) => line.includes("Summary") && line.includes("Actions"));
    expect(splitLine).toBeDefined();
    expect(splitLine!.indexOf("Actions")).toBeLessThan(splitLine!.indexOf("Summary"));
  });

  it("stacks plan panes on narrow terminals", async () => {
    const harness = await createHarness(SPLIT_COLUMNS - 16, 30);
    await harness.press("ARROW_DOWN", "RETURN");
    const frame = await harness.frame();

    expect(frame).toContain("Summary");
    expect(frame).toContain("Actions");
    expect(frame.split("\n").some((line) => line.includes("Summary") && line.includes("Actions"))).toBe(false);
    const lines = frame.split("\n");
    expect(lines.findIndex((line) => line.includes("Summary"))).toBeLessThan(
      lines.findIndex((line) => line.includes("Actions")),
    );
  });

  it("replaces the UI with a resize prompt below the minimum size", async () => {
    const harness = await createHarness(MIN_COLUMNS - 10, MIN_ROWS - 4);
    const frame = await harness.frame();

    expect(frame).toContain("Terminal too small");
    expect(frame).toContain(`${MIN_COLUMNS}x${MIN_ROWS}`);
    expect(frame).not.toContain("Update this project");
  });

  it("restores the full UI when the terminal grows back", async () => {
    const harness = await createHarness(MIN_COLUMNS - 10, MIN_ROWS - 4);
    expect(await harness.frame()).toContain("Terminal too small");

    harness.resize(100, 30);
    const frame = await harness.frame();
    expect(frame).not.toContain("Terminal too small");
    expect(frame).toContain("Update this project");
  });

  it("ignores workflow keys while the terminal is too small", async () => {
    const harness = await createHarness(MIN_COLUMNS - 1, MIN_ROWS - 1);
    await harness.press("RETURN", "ARROW_DOWN");

    expect(harness.controller.state.screen).toBe("flow");
    expect(harness.controller.state.cursor).toBe(0);
  });

  it("keeps long field values from overwriting their labels", async () => {
    const harness = await createHarness(SPLIT_COLUMNS + 4, 30);
    await harness.press("ARROW_DOWN", "RETURN");
    const frame = await harness.frame();

    const line = frame.split("\n").find((row) => row.includes("Base source"));
    expect(line).toBeDefined();
    expect(line).toMatch(/Base source\s/u);
  });
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

describe("TUI workflow runs", () => {
  it("shows the result screen after a successful run", async () => {
    const harness = await createHarness();
    harness.controller.state.sourceMode = "custom";
    harness.controller.state.customSource = join(process.cwd(), "example");

    await harness.controller.handleEffect({ type: "start", action: "validate" });

    expect(harness.controller.state.screen).toBe("result");
    expect(harness.controller.state.resultTitle).toContain("Complete");
    expect(await harness.frame()).toContain("Validate Complete");
  });

  it("shows the failure message and error log when a run throws", async () => {
    const harness = await createHarness();

    // No presets are selected, so the preset validation has nothing to read.
    await harness.controller.handleEffect({ type: "start", action: "presetValidate" });

    expect(harness.controller.state.resultTitle).toContain("Failed");
    expect(harness.controller.state.logs.some((log) => log.startsWith("[error]"))).toBe(true);
    expect(await harness.frame()).toContain("Preset Validate Failed");
  });

  it("aborts a running action and reports it as stopped", async () => {
    let actionSignal: AbortSignal | undefined;
    const harness = await createHarness(100, 30, {
      runAction: async (_state, _action, _logger, options) => {
        const signal = options?.signal;
        if (signal == null) throw new Error("Expected action cancellation signal.");
        actionSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true });
        });
      },
    });
    const pending = harness.controller.handleEffect({ type: "start", action: "build" });
    await harness.controller.handleEffect({ type: "cancelRunning" });
    await pending;

    expect(actionSignal?.aborted).toBe(true);
    expect(harness.controller.state.screen).toBe("result");
    expect(harness.controller.state.resultTitle).toBe("Build Stopped");
  });

  it("aborts active work and destroys the renderer on Ctrl+C", async () => {
    let actionSignal: AbortSignal | undefined;
    const harness = await createHarness(100, 30, {
      runAction: async (_state, _action, _logger, options) => {
        const signal = options?.signal;
        if (signal == null) throw new Error("Expected action cancellation signal.");
        actionSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true });
        });
      },
    });
    const originalDestroy = harness.renderer.destroy.bind(harness.renderer);
    let destroyCalls = 0;
    harness.renderer.destroy = () => {
      destroyCalls += 1;
      originalDestroy();
    };

    const pending = harness.controller.handleEffect({ type: "start", action: "install" });
    harness.mockInput.pressCtrlC();
    await pending;

    expect(actionSignal?.aborted).toBe(true);
    expect(destroyCalls).toBe(1);
    expect(harness.exitCodes).toEqual([0]);
  });

  it("initializes a missing source before resuming the pending action", async () => {
    const calls: string[] = [];
    const harness = await createHarness(100, 30, {
      initializeSource: async () => {
        calls.push("init");
      },
      runAction: async (_state, action) => {
        calls.push(action);
      },
    });
    harness.controller.state.pendingAction = "build";

    await harness.controller.handleEffect({ type: "initSource" });

    expect(calls).toEqual(["init", "build"]);
    expect(harness.controller.state.pendingAction).toBeUndefined();
    expect(harness.controller.state.resultTitle).toContain("Complete");
  });
});
