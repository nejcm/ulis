// TuiController preference-file round-tripping (future-version preferences left untouched) and the
// action run lifecycle: start/cancel/fail/exit, shutdown grace, and Ctrl+C during a running action.
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cleanupTempRoots } from "../test-utils/fs.js";
import { handleTuiKey } from "./keys.js";
import { cleanupControllerRenderers, createHarness, preferencesPath } from "./test-support.js";

afterEach(() => {
  cleanupControllerRenderers();
  cleanupTempRoots();
});

describe("TUI preference persistence", () => {
  it("leaves future-version preferences untouched for the session", async () => {
    const filePath = preferencesPath();
    const contents = '{\n  "version": 3,\n  "futureField": "preserve me"\n}\n';
    const reminder = "Preferences are newer than this ULIS; changes are not being saved.";
    writeFileSync(filePath, contents);
    const harness = await createHarness(100, 30, { preferencesPath: filePath });

    expect(harness.controller.state.notice).toBe(
      `TUI preferences at ${filePath} use version 3, which is newer than this ULIS understands. Your preferences will not be changed this session.`,
    );

    await harness.press("ARROW_DOWN", "RETURN");

    expect(harness.controller.state.screen).toBe("plan");
    expect(harness.controller.state.notice).toBe(reminder);
    expect(readFileSync(filePath, "utf-8")).toBe(contents);

    harness.controller.state.flow = "presetsOnly";
    await harness.controller.handleEffect({ type: "loadCustomPresetSource", path: "/tmp/presets" });
    expect(harness.controller.state.notice).toBe("No presets found in custom directory: /tmp/presets");
    expect(readFileSync(filePath, "utf-8")).toBe(contents);

    await harness.press("BACKSPACE");
    expect(harness.controller.state.notice).toBe(reminder);
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

  it("exits non-zero after q stops an install and q quits the result", async () => {
    const harness = await createHarness(100, 30, {
      runAction: async (_state, _action, _logger, options) => {
        await new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("stopped")), { once: true });
        });
      },
    });
    const stopping = harness.controller.handleEffect({ type: "start", action: "install" });
    await harness.controller.handleEffect(handleTuiKey(harness.controller.state, "q"));
    await stopping;
    expect(harness.controller.state.resultTitle).toBe("Install Stopped");
    await harness.controller.handleEffect(handleTuiKey(harness.controller.state, "q"));

    expect(harness.exitCodes).toEqual([1]);
  });

  it("exits non-zero after a failed install", async () => {
    const harness = await createHarness(100, 30, {
      runAction: async () => {
        throw new Error("install broke");
      },
    });
    await harness.controller.handleEffect({ type: "start", action: "install" });
    expect(harness.controller.state.resultTitle).toBe("Install Failed");
    await harness.controller.handleEffect({ type: "exit", code: 0 });

    expect(harness.exitCodes).toEqual([1]);
  });

  it("exits zero after a successful run clears an earlier failure", async () => {
    let fail = true;
    const stderr: string[] = [];
    const harness = await createHarness(100, 30, {
      writeStderr: (message) => stderr.push(message),
      runAction: async () => {
        if (fail) throw new Error("first run failed");
      },
    });

    await harness.controller.handleEffect({ type: "start", action: "install" });
    fail = false;
    await harness.controller.handleEffect({ type: "start", action: "install" });
    await harness.controller.handleEffect({ type: "exit", code: 0 });

    expect(harness.exitCodes).toEqual([0]);
    expect(stderr).toEqual([]);
  });

  it("still exits when the shutdown summary write fails", async () => {
    const harness = await createHarness(100, 30, {
      writeStderr: () => {
        throw new Error("stderr failed");
      },
      runAction: async () => {
        throw new Error("install broke");
      },
    });

    await harness.controller.handleEffect({ type: "start", action: "install" });
    await harness.controller.handleEffect({ type: "exit", code: 0 });

    expect(harness.exitCodes).toEqual([1]);
  });

  it("routes Ctrl+C from the running app to a non-zero shutdown", async () => {
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

    const pending = harness.controller.handleEffect({ type: "start", action: "install" });
    harness.mockInput.pressCtrlC();
    await pending;
    await Bun.sleep(0);

    expect(actionSignal?.aborted).toBe(true);
    expect(harness.exitCodes).toEqual([1]);
  });

  it("waits for an interrupted install before exiting non-zero", async () => {
    let actionSignal: AbortSignal | undefined;
    let markStarted: (() => void) | undefined;
    let releaseRun: (() => void) | undefined;
    const stderr: string[] = [];
    const runStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const holdRun = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const harness = await createHarness(100, 30, {
      writeStderr: (message) => stderr.push(message),
      runAction: async (_state, _action, logger, options) => {
        const signal = options?.signal;
        if (signal == null) throw new Error("Expected action cancellation signal.");
        actionSignal = signal;
        logger.info("Install summary — installed: [claude]");
        markStarted?.();
        await holdRun;
      },
    });
    const originalDestroy = harness.renderer.destroy.bind(harness.renderer);
    let destroyCalls = 0;
    harness.renderer.destroy = () => {
      destroyCalls += 1;
      originalDestroy();
    };

    const pending = harness.controller.handleEffect({ type: "start", action: "install" });
    await runStarted;
    const shuttingDown = harness.controller.handleEffect({ type: "exit", code: 0 });

    expect(actionSignal?.aborted).toBe(true);
    expect(harness.exitCodes).toEqual([]);
    expect(destroyCalls).toBe(0);
    expect(stderr).toEqual([]);

    releaseRun?.();
    await Promise.all([pending, shuttingDown]);

    expect(destroyCalls).toBe(1);
    expect(harness.exitCodes).toEqual([1]);
    expect(stderr).toEqual(["Install summary — installed: [claude]\n"]);
  });

  it("exits promptly when Ctrl+C is pressed again", async () => {
    let markStarted: (() => void) | undefined;
    let releaseRun: (() => void) | undefined;
    const runStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const holdRun = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const harness = await createHarness(100, 30, {
      runAction: async () => {
        markStarted?.();
        await holdRun;
      },
    });
    const originalDestroy = harness.renderer.destroy.bind(harness.renderer);
    let destroyCalls = 0;
    harness.renderer.destroy = () => {
      destroyCalls += 1;
      originalDestroy();
    };

    const running = harness.controller.handleEffect({ type: "start", action: "install" });
    await runStarted;
    const firstShutdown = harness.controller.handleEffect({ type: "exit", code: 0 });
    expect(harness.exitCodes).toEqual([]);

    await harness.controller.handleEffect({ type: "exit", code: 0 });

    expect(destroyCalls).toBe(1);
    expect(harness.exitCodes).toEqual([1]);

    releaseRun?.();
    await Promise.all([running, firstShutdown]);
    expect(destroyCalls).toBe(1);
    expect(harness.exitCodes).toEqual([1]);
  });

  it("bounds the graceful shutdown wait", async () => {
    let markStarted: (() => void) | undefined;
    const runStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const harness = await createHarness(100, 30, {
      shutdownGraceMs: 10,
      runAction: async () => {
        markStarted?.();
        await new Promise<void>(() => {});
      },
    });

    void harness.controller.handleEffect({ type: "start", action: "install" });
    await runStarted;
    await harness.controller.handleEffect({ type: "exit", code: 0 });

    expect(harness.exitCodes).toEqual([1]);
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
