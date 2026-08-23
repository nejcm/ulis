// TuiController remote-source flow: cloning a remote/preset source for review, disposing the clone
// on every exit path (interrupt, supersession, back-out, failure), and keeping the review bound to
// the settings and fingerprint it was generated for.
import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { __test as installTest } from "../install.js";
import { cleanupTempRoots, createTempRoot } from "../test-utils/fs.js";
import { handleTuiKey } from "./keys.js";
import { planItems, reviewFingerprint } from "./selectors.js";
import { PRESET_INSTALL_REVIEW_START_ROW, type TuiState } from "./state-model.js";
import { cleanupControllerRenderers, createHarness, KEY_DELAY_MS } from "./test-support.js";

afterEach(() => {
  cleanupControllerRenderers();
  cleanupTempRoots();
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

  it("disposes the reviewed clone once after an interrupted install settles", async () => {
    const cloned = mockClone();
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
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];
    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });

    const internals = harness.controller as unknown as {
      preparedRemote: { cleanup: () => void };
    };
    const cleanup = internals.preparedRemote.cleanup;
    let cleanupCalls = 0;
    internals.preparedRemote.cleanup = () => {
      cleanupCalls += 1;
      cleanup();
    };

    const running = harness.controller.handleEffect({ type: "start", action: "install" });
    await runStarted;
    const shuttingDown = harness.controller.handleEffect({ type: "exit", code: 0 });

    expect(cleanupCalls).toBe(0);
    expect(cloned.map(existsSync)).toEqual([true]);
    expect(harness.exitCodes).toEqual([]);

    releaseRun?.();
    await Promise.all([running, shuttingDown]);

    expect(cleanupCalls).toBe(1);
    expect(cloned.map(existsSync)).toEqual([false]);
    expect(harness.exitCodes).toEqual([1]);
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

  it("escapes display controls in the remote source before review", async () => {
    mockClone();
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = "https://github.com/o/r\u202E\u200B";
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });

    expect(state.remoteCommandSource).toBe("https://github.com/o/r\\u202e\\u200b");
    const frame = await harness.frame();
    expect(frame).toContain("github.com/o/r\\u202e\\u200b");
    expect(frame).not.toContain("\u202E");
    expect(frame).not.toContain("\u200B");
    await harness.controller.shutdown(0);
  });

  it("clears a remote install review before showing a local review", async () => {
    const cloned = mockClone();
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    const remoteFrame = await harness.frame();
    const cloneExistsBeforeBack = cloned.map(existsSync);

    await harness.press("BACKSPACE");
    const localSource = createTempRoot("ulis-tui-local-source-");
    writeFileSync(join(localSource, "config.yaml"), "version: 1\n", "utf-8");
    state.customSource = localSource;
    focusInstall(state);
    await harness.controller.handleEffect(handleTuiKey(state, "enter"));

    const localFrame = await harness.frame();
    expect({
      remoteFrameShowsSource: remoteFrame.includes(url),
      remoteFrameShowsWarning: remoteFrame.includes("WILL apply"),
      cloneExistsBeforeBack,
      screen: state.screen,
      cloneExistsAfterBack: cloned.map(existsSync),
      commandsAfterBack: state.remoteCommands,
      commandSourceAfterBack: state.remoteCommandSource,
      localFrameShowsSource: localFrame.includes(localSource),
      localFrameShowsRemote: localFrame.includes(url),
      localFrameShowsWarning: localFrame.includes("WILL apply"),
    }).toEqual({
      remoteFrameShowsSource: true,
      remoteFrameShowsWarning: true,
      cloneExistsBeforeBack: [true],
      screen: "installReview",
      cloneExistsAfterBack: [false],
      commandsAfterBack: [],
      commandSourceAfterBack: "",
      localFrameShowsSource: true,
      localFrameShowsRemote: false,
      localFrameShowsWarning: false,
    });
  });

  it("keeps the prepared clone while a remote install handles a stray key", async () => {
    const cloned = mockClone();
    let releaseRun: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const runStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const holdRun = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    let receivedPrepared = false;
    const harness = await createHarness(100, 30, {
      runAction: (async (_state: TuiState, _action: string, _logger: unknown, options: { prepared?: unknown }) => {
        receivedPrepared = options?.prepared != null;
        markStarted?.();
        await holdRun;
      }) as never,
    });
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    const running = harness.controller.handleEffect({ type: "start", action: "install" });
    await runStarted;
    const strayEffect = handleTuiKey(state, "down");
    await harness.controller.handleEffect(strayEffect);
    const cloneExistsDuringRun = cloned.map(existsSync);
    releaseRun?.();
    await running;
    const cloneExistsAfterRun = cloned.map(existsSync);

    expect({ strayEffect, receivedPrepared, cloneExistsDuringRun, cloneExistsAfterRun }).toEqual({
      strayEffect: { type: "none" },
      receivedPrepared: true,
      cloneExistsDuringRun: [true],
      cloneExistsAfterRun: [false],
    });
  });

  it("clears a remote preset review on its Back row and re-prepares it when reopened", async () => {
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

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "presetInstall" });
    expect(cloned.map(existsSync)).toEqual([true]);

    state.cursor = PRESET_INSTALL_REVIEW_START_ROW + 1;
    await harness.controller.handleEffect(handleTuiKey(state, "enter"));
    expect(cloned.map(existsSync)).toEqual([false]);
    expect(state.remoteCommands).toEqual([]);
    expect(state.remoteCommandSource).toBe("");

    focusInstall(state);
    await Bun.sleep(KEY_DELAY_MS);
    await harness.controller.handleEffect(handleTuiKey(state, "enter"));
    expect(state.screen).toBe("presetInstallReview");
    expect(cloned).toHaveLength(2);
    expect(cloned.map(existsSync)).toEqual([false, true]);

    state.cursor = PRESET_INSTALL_REVIEW_START_ROW;
    await Bun.sleep(KEY_DELAY_MS);
    await harness.controller.handleEffect(handleTuiKey(state, "enter"));
    expect(runCalls[0]!.prepared).toBeDefined();
    expect(cloned.map(existsSync)).toEqual([false, false]);
  });

  it("clears a prepared remote review when flow defaults are applied", async () => {
    const cloned = mockClone();
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    expect(cloned.map(existsSync)).toEqual([true]);

    state.screen = "flow";
    state.cursor = 0;
    await harness.controller.handleEffect(handleTuiKey(state, "enter"));

    expect(state.flow).toBe("project");
    expect(cloned.map(existsSync)).toEqual([false]);
    expect(state.remoteCommands).toEqual([]);
    expect(state.remoteCommandSource).toBe("");
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

  it("waits unbounded for an in-flight clone before exiting", async () => {
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
    const harness = await createHarness(100, 30, { shutdownGraceMs: 10 });
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    const preparing = harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    await Bun.sleep(10);
    const shutting = harness.controller.shutdown(0);
    await Bun.sleep(20);
    await harness.controller.shutdown(0);

    expect(harness.exitCodes).toEqual([]);
    expect(cloned.map(existsSync)).toEqual([true]);

    release?.();
    await Promise.all([preparing, shutting]);

    expect(cloned).toHaveLength(1);
    expect(cloned.map(existsSync)).toEqual([false]);
    expect(harness.exitCodes).toEqual([1]);
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

  it("discards a superseded preparation's clone and publishes the newer one", async () => {
    const secondUrl = "https://github.com/o/r2";
    const cloned = mockClone();
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    // Overlapping preparations for two different sources: the second bumps the generation and
    // aborts the first before the first ever resumes from its own await.
    const first = harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    state.customSource = secondUrl;
    const second = harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    await Promise.all([first, second]);

    // Never the first: a stale preparation resuming after the newer one published must not win.
    expect(state.remoteCommandSource).toBe(secondUrl);
    expect(cloned.map(existsSync)).toEqual([false, true]);

    await harness.controller.shutdown(0);
  });

  it("discards a superseded preparation that rejects after being superseded", async () => {
    const secondUrl = "https://github.com/o/r2";
    const cloned: string[] = [];
    let rejectFirst: ((error: Error) => void) | undefined;
    installTest.setRuntimeDependencies({
      runCommand(_lookup: string, args: readonly string[]) {
        return { status: args[0] === "gh" ? 1 : 0 } as never;
      },
      async runAsyncCommand(command: string, args: readonly string[]) {
        if (command !== "git") return { status: 0, stdout: "", stderr: "" };
        const dir = args[args.length - 1]!;
        cloned.push(join(dir, ".."));
        // The first clone hangs, then fails, only after the second preparation has published.
        if (cloned.length === 1) {
          return new Promise<never>((_resolve, reject) => {
            rejectFirst = reject;
          });
        }
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "config.yaml"), "version: 1\n", "utf-8");
        return { status: 0, stdout: "", stderr: "" };
      },
    } as never);

    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    const first = harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    await Bun.sleep(10);
    state.customSource = secondUrl;
    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });

    expect(state.remoteCommandSource).toBe(secondUrl);
    expect(state.screen).toBe("installReview");

    // The superseded first preparation now fails; its own catch handling must not clobber the
    // review the second preparation already published.
    rejectFirst?.(new Error("boom"));
    await first;

    expect(state.remoteCommandSource).toBe(secondUrl);
    expect(state.screen).toBe("installReview");
    expect(state.notice).toBe("");

    await harness.controller.shutdown(0);
  });

  it("does not let a superseded preparation's cleanup clear an active prepareAbort", async () => {
    const cloned: string[] = [];
    const releases: (() => void)[] = [];
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
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        return { status: 0, stdout: "", stderr: "" };
      },
    } as never);

    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.platforms = ["claude"];

    state.customSource = `${url}/a`;
    const first = harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    await Bun.sleep(10);

    state.customSource = `${url}/b`;
    const second = harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    await Bun.sleep(10);

    state.customSource = `${url}/c`;
    const third = harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    await Bun.sleep(10);

    // Let the twice-superseded first settle while the third is still the live preparation.
    releases[0]?.();
    await first;

    // A stale preparation's own cleanup must not clear `prepareAbort` out from under the still
    // in-flight third preparation: cancelling must still reach it.
    state.logs = [];
    await harness.controller.handleEffect({ type: "cancelRunning" });
    expect(state.logs).toContain("[warn] Stopping remote fetch...");

    releases[1]?.();
    releases[2]?.();
    await Promise.all([second, third]);
    await harness.controller.shutdown(0);
  });

  it("discards a preparation invalidated mid-clone even when its own controller was never aborted", async () => {
    // `prepareRemoteInstall`'s post-clone check and its `abort.signal.aborted` check normally fire
    // together, because superseding a preparation always aborts its controller first - so a test
    // that only supersedes through the normal call path cannot isolate the post-clone check from
    // that backstop. Bumping `prepareGeneration` directly (the same reflection `preparedRemote`
    // tests above already use) reproduces staleness without touching `prepareAbort`, isolating it.
    const cloned = mockClone();
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    const internals = harness.controller as unknown as { prepareGeneration: number };
    const preparing = harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    internals.prepareGeneration += 1;
    await preparing;

    expect(state.remoteCommandSource).toBe("");
    expect(state.screen).not.toBe("installReview");
    expect(cloned.map(existsSync)).toEqual([false]);

    // The discard path never reaches `clearSpinner()` (nothing to redraw for a stale
    // preparation), so the spinner interval only stops here, same as every other test above.
    await harness.controller.shutdown(0);
  });

  it("does not reuse a stale published review while a differently-keyed clone is in flight", async () => {
    // The reuse fast path's `prepareAbort == null` guard is redundant whenever the invariant
    // "starting a new fetch always disposes the previous `preparedRemote` first" holds - so it can
    // only matter if that invariant is ever violated. Reflection manufactures the violation
    // directly (an in-flight fetch coexisting with a stale `preparedRemote` for the key being
    // asked for) rather than relying on another bug to produce it, so this test exercises the
    // guard on its own. The assertion below it, on the other hand, checks that invariant itself
    // on the real call path - the property that actually matters, kept alongside the guard check
    // rather than in place of it.
    const cloned = mockClone();
    const harness = await createHarness();
    const state = harness.controller.state;
    state.sourceMode = "custom";
    state.customSource = url;
    state.platforms = ["claude"];

    await harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    const internals = harness.controller as unknown as {
      preparedRemote: { cleanup: () => void } | undefined;
      prepareAbort: AbortController | undefined;
    };
    const staleReview = internals.preparedRemote;
    expect(staleReview).toBeDefined();
    // Capture and chain to the real cleanup, same as the reflection sites this pattern is borrowed
    // from (above, and `signals.test.ts`): replacing it outright would strand the clone on disk.
    const realCleanup = staleReview!.cleanup;
    let staleCleanupCalls = 0;
    staleReview!.cleanup = (() => {
      staleCleanupCalls += 1;
      realCleanup();
    }) as never;

    // Simulate an in-flight fetch for the same key coexisting with the stale review - impossible
    // through the normal call path, since starting that fetch would have disposed it first.
    internals.prepareAbort = new AbortController();

    const second = harness.controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
    // The invariant the guard exists to protect, checked on the real call path rather than through
    // reflection: once this (genuine) second preparation is under way, the fetch it is running
    // means nothing may be reused, so `preparedRemote` must be undefined for as long as it is
    // in flight.
    expect(internals.prepareAbort).toBeDefined();
    expect(internals.preparedRemote).toBeUndefined();
    await second;

    // A real fetch must run rather than reusing the stale entry: the stale review is disposed and
    // a second clone is made, rather than being silently republished untouched.
    expect(staleCleanupCalls).toBe(1);
    expect(cloned).toHaveLength(2);

    await harness.controller.shutdown(0);
  });
});
