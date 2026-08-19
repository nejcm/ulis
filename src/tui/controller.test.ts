import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";

import { __test as installTest } from "../install.js";
import { TuiController, type TuiControllerOptions } from "./controller.js";
import { handleTuiKey, planItems, reviewFingerprint, PRESET_INSTALL_REVIEW_START_ROW, type TuiState } from "./state.js";
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
    const resumeOptions: { cwd?: string; signal?: AbortSignal }[] = [];
    const harness = await createHarness(100, 30, {
      cwd: "/tmp/ulis-injected-cwd",
      initializeSource: async () => {
        calls.push("init");
      },
      runAction: async (_state, action, _logger, options) => {
        calls.push(action);
        resumeOptions.push({ cwd: options?.cwd, signal: options?.signal });
      },
    });
    harness.controller.state.pendingAction = "build";

    await harness.controller.handleEffect({ type: "initSource" });

    expect(calls).toEqual(["init", "build"]);
    // Same cwd the plan screen resolved with: without it the resumed action plans against
    // `process.cwd()` and can install somewhere the user was never shown.
    expect(resumeOptions[0]!.cwd).toBe("/tmp/ulis-injected-cwd");
    expect(resumeOptions[0]!.signal).toBeDefined();
    expect(harness.controller.state.pendingAction).toBeUndefined();
    expect(harness.controller.state.resultTitle).toContain("Complete");
  });
});

describe("remote install consent", () => {
  const url = "https://github.com/o/r";

  /** Clone stub that materialises a source tree with a real extensions manifest. */
  function mockClone(): string[] {
    const cloned: string[] = [];
    installTest.setRuntimeDependencies({
      runCommand(_lookup: string, args: readonly string[]) {
        return { status: args[0] === "gh" ? 1 : 0 } as never;
      },
      async runAsyncCommand(command: string, args: readonly string[]) {
        if (command !== "git") return { status: 0, stdout: "", stderr: "" };
        const dir = args[args.length - 1]!;
        cloned.push(join(dir, ".."));
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "config.yaml"), "version: 1\nname: remote\n", "utf-8");
        writeFileSync(join(dir, "extensions.yaml"), '"*":\n  extensions:\n    - name: evil-package\n', "utf-8");
        return { status: 0, stdout: "", stderr: "" };
      },
    } as never);
    return cloned;
  }

  afterEach(() => {
    installTest.resetRuntimeDependencies();
  });

  it("lists the remote source's real commands on the review screen", async () => {
    const cloned = mockClone();
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });

    // Read out of the cloned manifest, not invented by the TUI.
    expect(state.remoteCommands.join(" ")).toContain("evil-package");
    expect(state.remoteCommandSource).toBe(url);
    expect(state.screen).toBe("installReview");
    // The clone is kept for the install that follows, so consent matches what runs.
    expect(cloned.map(existsSync)).toEqual([true]);

    await harness.controller.shutdown(0);
    expect(cloned.map(existsSync)).toEqual([false]);
  });

  it("disposes the previous clone when preparation runs again", async () => {
    const cloned = mockClone();
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    // Options change the command list, not the tree it is read from: no second fetch.
    state.platforms = ["claude", "cursor"];
    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    expect(cloned).toHaveLength(1);

    // A different remote is a different tree, and reviewing it must not strand the first clone.
    state.customSource = "https://github.com/o/other";
    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });

    expect(cloned).toHaveLength(2);
    expect(existsSync(cloned[0]!)).toBe(false);
    expect(existsSync(cloned[1]!)).toBe(true);

    await harness.controller.shutdown(0);
    expect(cloned.map(existsSync)).toEqual([false, false]);
  });

  it("keeps only the newest clone when two preparations overlap", async () => {
    const cloned = mockClone();
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    // Overlapping preparations: the superseded one must throw its own clone away.
    await Promise.all([
      harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" }),
      harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" }),
    ]);

    expect(cloned.filter(existsSync)).toHaveLength(1);
    await harness.controller.shutdown(0);
    expect(cloned.filter(existsSync)).toHaveLength(0);
  });

  it("waits for a superseded preparation before exiting", async () => {
    const cloned: string[] = [];
    let release: (() => void) | undefined;
    installTest.setRuntimeDependencies({
      runCommand(_lookup: string, args: readonly string[]) {
        return { status: args[0] === "gh" ? 1 : 0 } as never;
      },
      async runAsyncCommand(command: string, args: readonly string[]) {
        if (command !== "git") return { status: 0, stdout: "", stderr: "" };
        const dir = args[args.length - 1]!;
        cloned.push(join(dir, ".."));
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "config.yaml"), "version: 1\n", "utf-8");
        // Only the first (soon superseded) clone hangs; the second finishes straight away.
        if (cloned.length === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    } as never);
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    const preparingFirst = harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    await Bun.sleep(10);
    state.platforms = ["claude", "cursor"];
    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });

    // Shutdown must await the first preparation too, not just the newest one.
    const shutting = harness.controller.shutdown(0);
    setTimeout(() => release?.(), 5);
    await shutting;

    expect(cloned).toHaveLength(2);
    expect(cloned.filter(existsSync)).toHaveLength(0);
    await preparingFirst;
  });

  it("binds the review to the settings it was generated for", async () => {
    const cloned = mockClone();
    const runCalls: { prepared: unknown }[] = [];
    const harness = await createHarness(100, 30, {
      runAction: ((_state: TuiState, _action: string, _logger: unknown, opts: { prepared?: unknown }) => {
        runCalls.push({ prepared: opts.prepared });
        return Promise.resolve();
      }) as never,
    });
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    expect(reviewFingerprint(state, "install")).toBe(reviewFingerprint(state, "install"));

    // A setting the review was generated for changes without going back through the review screen.
    state.skipExternalSkills = !state.skipExternalSkills;
    await harness.controller.handleEffect({ type: "start", action: "install" });

    // The controller must not hand the stale review to the run, and must drop its clone.
    expect(runCalls).toHaveLength(1);
    expect(runCalls[0]!.prepared).toBeUndefined();
    expect(cloned.map(existsSync)).toEqual([false]);
    await harness.controller.shutdown(0);
  });

  it("does not hand a remote review to a later local start", async () => {
    const cloned = mockClone();
    const runCalls: { sourceDir: string; prepared: unknown }[] = [];
    const harness = await createHarness(100, 30, {
      runAction: ((
        state: { customSource: string },
        _action: string,
        _logger: unknown,
        opts: { prepared?: unknown },
      ) => {
        runCalls.push({ sourceDir: state.customSource, prepared: opts.prepared });
        return Promise.resolve();
      }) as never,
    });
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    expect(cloned.map(existsSync)).toEqual([true]);

    // Back out of the review and switch to a purely local source.
    state.sourceMode = "project";
    state.customSource = "";
    await harness.controller.handleEffect({ type: "start", action: "install" });

    // The stale remote clone must neither be passed along nor left on disk.
    expect(runCalls[0]!.prepared).toBeUndefined();
    expect(cloned.map(existsSync)).toEqual([false]);
    await harness.controller.shutdown(0);
  });

  it("plans from a snapshot taken with the fingerprint, not from live state", async () => {
    const harness = await createHarness();
    const state = harness.controller.state;
    // Toggled off mid-clone and back on afterwards: the review must reflect the settings it was
    // fingerprinted for, not the value that happened to be live when planning ran.
    installTest.setRuntimeDependencies({
      runCommand(_lookup: string, args: readonly string[]) {
        return { status: args[0] === "gh" ? 1 : 0 } as never;
      },
      async runAsyncCommand(command: string, args: readonly string[]) {
        if (command !== "git") return { status: 0, stdout: "", stderr: "" };
        state.skipExternalSkills = true;
        const dir = args[args.length - 1]!;
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "config.yaml"), "version: 1\nname: remote\n", "utf-8");
        writeFileSync(join(dir, "extensions.yaml"), '"*":\n  extensions:\n    - name: evil-package\n', "utf-8");
        // The skills command is the one `skipExternalSkills` gates, so it is what proves the plan
        // came from the snapshot rather than from the value live when planning ran.
        writeFileSync(join(dir, "skills.yaml"), '"*":\n  skills:\n    - name: test/skill\n', "utf-8");
        return { status: 0, stdout: "", stderr: "" };
      },
    } as never);
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];
    state.skipExternalSkills = false;

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    state.skipExternalSkills = false;

    expect(state.remoteCommands.join(" ")).toContain("evil-package");
    // Planned with skills enabled, as fingerprinted - not with the value set during the clone.
    expect(state.remoteCommands.join(" ")).toContain("test/skill");
    await harness.controller.shutdown(0);
  });

  it("removes an in-flight clone before exiting", async () => {
    const cloned: string[] = [];
    let release: (() => void) | undefined;
    installTest.setRuntimeDependencies({
      runCommand(_lookup: string, args: readonly string[]) {
        return { status: args[0] === "gh" ? 1 : 0 } as never;
      },
      async runAsyncCommand(command: string, args: readonly string[]) {
        if (command !== "git") return { status: 0, stdout: "", stderr: "" };
        const dir = args[args.length - 1]!;
        cloned.push(join(dir, ".."));
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "config.yaml"), "version: 1\n", "utf-8");
        // Hold the clone open so shutdown lands while it is still in flight.
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { status: 0, stdout: "", stderr: "" };
      },
    } as never);
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    const preparing = harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    await Bun.sleep(10);
    const shutting = harness.controller.shutdown(0);
    release?.();
    await Promise.all([preparing, shutting]);

    expect(cloned).toHaveLength(1);
    expect(cloned.map(existsSync)).toEqual([false]);
  });

  /** Puts the plan screen's cursor on Install, so a real `enter` starts the remote flow. */
  function focusInstall(state: TuiState): void {
    state.screen = "plan";
    state.cursor = planItems(state).findIndex((item) => item.id === "install");
  }

  it("keeps the remote preset review valid when its own toggles are used", async () => {
    const cloned = mockClone();
    const runCalls: { prepared: unknown }[] = [];
    const harness = await createHarness(100, 30, {
      runAction: ((_state: TuiState, _action: string, _logger: unknown, opts: { prepared?: unknown }) => {
        runCalls.push({ prepared: opts.prepared });
        return Promise.resolve();
      }) as never,
    });
    const state = harness.controller.state;
    state.flow = "presetsOnly";
    state.presetSourceMode = "custom";
    state.customPresetSource = url;
    state.platforms = ["claude"];
    focusInstall(state);

    // Real keys through the real handler, the way the screen is actually used.
    await harness.controller.handleEffect(handleTuiKey(state, "enter"));
    expect(state.screen).toBe("presetInstallReview");
    // Land on "Start preset install", never on a toggle a confirming Enter would flip instead.
    expect(state.cursor).toBe(PRESET_INSTALL_REVIEW_START_ROW);

    // Every toggle on this screen is part of the review fingerprint.
    state.cursor = 0;
    await harness.controller.handleEffect(handleTuiKey(state, "x"));
    expect(state.backup).toBe(false);
    expect(state.screen).toBe("presetInstallReview");
    // Regenerated from the clone already on disk: using the screen must not re-fetch the remote.
    expect(cloned).toHaveLength(1);

    state.cursor = PRESET_INSTALL_REVIEW_START_ROW;
    await harness.controller.handleEffect(handleTuiKey(state, "enter"));

    // The review the user just used is still the one that runs.
    expect(runCalls).toHaveLength(1);
    expect(runCalls[0]!.prepared).toBeDefined();
    expect(state.resultTitle).toContain("Complete");
    await harness.controller.shutdown(0);
  });

  it("shows the fetch on the running screen and ignores plan edits while it runs", async () => {
    let release: (() => void) | undefined;
    installTest.setRuntimeDependencies({
      runCommand(_lookup: string, args: readonly string[]) {
        return { status: args[0] === "gh" ? 1 : 0 } as never;
      },
      async runAsyncCommand(command: string, args: readonly string[]) {
        if (command !== "git") return { status: 0, stdout: "", stderr: "" };
        const dir = args[args.length - 1]!;
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "config.yaml"), "version: 1\n", "utf-8");
        // Hold the clone open so the assertions land while it is still in flight.
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { status: 0, stdout: "", stderr: "" };
      },
    } as never);
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];
    focusInstall(state);

    const preparing = harness.controller.handleEffect(handleTuiKey(state, "enter"));
    await Bun.sleep(10);

    // Announced, not silent: the same running screen every other long operation uses.
    expect(state.screen).toBe("running");
    expect(await harness.frame()).toContain("Fetch remote source");

    // And inert: a keypress that would edit the plan cannot invalidate the review being prepared.
    handleTuiKey(state, "x");
    expect(state.backup).toBe(true);

    // `q` cancels the fetch rather than quitting the whole TUI.
    await harness.controller.handleEffect(handleTuiKey(state, "q"));
    expect(harness.exitCodes).toEqual([]);

    release?.();
    await preparing;
    expect(state.screen).toBe("plan");
    expect(state.notice).toContain("stopped by user");

    await harness.controller.shutdown(0);
  });

  it("surfaces a failed clone as a notice instead of crashing", async () => {
    installTest.setRuntimeDependencies({
      runCommand(_lookup: string, args: readonly string[]) {
        return { status: args[0] === "gh" ? 1 : 0 } as never;
      },
      async runAsyncCommand() {
        return { status: 1, stdout: "", stderr: "fatal: repository not found" };
      },
    } as never);
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });

    expect(state.notice).toContain("Failed to clone");
    expect(state.remoteCommands).toEqual([]);
    expect(state.screen).not.toBe("installReview");
  });
});
