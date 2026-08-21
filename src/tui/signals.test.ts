import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";

import { __test as installTest } from "../install.js";
import { runTui } from "../tui.js";
import type { TuiController, TuiControllerOptions } from "./controller.js";

const roots: string[] = [];
const renderers: TestRendererSetup["renderer"][] = [];
const releases: (() => void)[] = [];
type TerminationSignal = "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGQUIT";
type SignalSnapshot = Record<TerminationSignal, ((signal: NodeJS.Signals) => void)[]>;

function preferencesPath(): string {
  const root = mkdtempSync(join(tmpdir(), "ulis-tui-signals-"));
  roots.push(root);
  return join(root, "preferences.json");
}

function snapshotSignalListeners(): SignalSnapshot {
  return {
    SIGHUP: process.listeners("SIGHUP"),
    SIGINT: process.listeners("SIGINT"),
    SIGQUIT: process.listeners("SIGQUIT"),
    SIGTERM: process.listeners("SIGTERM"),
  };
}

function fireNewListeners(signal: TerminationSignal, before: SignalSnapshot): void {
  const listeners = process.listeners(signal).filter((listener) => !before[signal].includes(listener));
  expect(listeners.length).toBeGreaterThan(0);
  for (const listener of listeners) listener(signal);
}

async function startTui(options: TuiControllerOptions = {}): Promise<{
  controller: TuiController;
  exitCodes: number[];
  exited: Promise<number>;
  fire: (signal: TerminationSignal) => void;
  setup: TestRendererSetup;
  stderr: string[];
}> {
  const signalListeners = snapshotSignalListeners();
  const exitCodes: number[] = [];
  const stderr: string[] = [];
  let resolveExit: ((code: number) => void) | undefined;
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  let controller: TuiController | undefined;
  let setup: TestRendererSetup | undefined;
  await runTui({
    ...options,
    createRenderer: async () => {
      setup = await createTestRenderer({ width: 100, height: 30 });
      renderers.push(setup.renderer);
      return setup.renderer;
    },
    exit: (code) => {
      exitCodes.push(code);
      resolveExit?.(code);
    },
    writeStderr: options.writeStderr ?? ((message) => stderr.push(message)),
    listPresets: () => [],
    onController: (value) => void (controller = value),
    preferencesPath: preferencesPath(),
  });
  expect(process.listenerCount("SIGTERM")).toBe(signalListeners.SIGTERM.length + 2);
  if (!controller || !setup) throw new Error("TUI exited before its renderer was ready.");
  return {
    controller,
    exitCodes,
    exited,
    fire: (signal) => fireNewListeners(signal, signalListeners),
    setup,
    stderr,
  };
}

function mockClone(hold?: Promise<void>, started?: () => void): string[] {
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
      writeFileSync(join(dir, "config.yaml"), "version: 1\n", "utf-8");
      started?.();
      if (hold) await hold;
      return { status: 0, stdout: "", stderr: "" };
    },
  } as never);
  return cloned;
}

async function prepareRemote(controller: TuiController): Promise<void> {
  controller.state.sourceMode = "custom";
  controller.state.customSource = "https://github.com/o/r";
  controller.state.platforms = ["claude"];
  await controller.handleEffect({ type: "prepareRemoteInstall", action: "install" });
}

afterEach(() => {
  for (const release of releases.splice(0)) release();
  installTest.resetRuntimeDependencies();
  for (const renderer of renderers.splice(0)) {
    try {
      renderer.destroy();
    } catch {}
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("TUI termination signals", () => {
  it("exits non-zero when a signal arrives before the renderer exists", async () => {
    const before = snapshotSignalListeners();
    const exitCodes: number[] = [];
    let controllerCreated = false;
    let releaseRenderer: (() => void) | undefined;
    const rendererReady = new Promise<void>((resolve) => {
      releaseRenderer = resolve;
    });
    const starting = runTui({
      createRenderer: async () => {
        await rendererReady;
        const setup = await createTestRenderer({ width: 100, height: 30 });
        renderers.push(setup.renderer);
        return setup.renderer;
      },
      exit: (code) => exitCodes.push(code),
      listPresets: () => [],
      onController: () => void (controllerCreated = true),
      preferencesPath: preferencesPath(),
    });

    expect(process.listenerCount("SIGHUP")).toBe(before.SIGHUP.length + 1);
    fireNewListeners("SIGHUP", before);
    expect(exitCodes).toEqual([129]);
    expect(process.listenerCount("SIGHUP")).toBe(before.SIGHUP.length);

    releaseRenderer?.();
    await starting;
    expect(controllerCreated).toBe(false);
    expect(process.listeners("SIGHUP")).toEqual(before.SIGHUP);
  });

  for (const [signal, code] of [
    ["SIGHUP", 129],
    ["SIGINT", 130],
    ["SIGQUIT", 131],
    ["SIGTERM", 143],
  ] as const) {
    it(`${signal} disposes a reviewed clone before exiting ${code}`, async () => {
      const cloned = mockClone();
      const runtime = await startTui();
      await prepareRemote(runtime.controller);
      expect(cloned.map(existsSync)).toEqual([true]);

      runtime.fire(signal);
      expect(await runtime.exited).toBe(code);

      expect(cloned.map(existsSync)).toEqual([false]);
      expect(runtime.exitCodes).toEqual([code]);
      expect(runtime.stderr).toEqual(["ULIS workflow interrupted.\n"]);
    });
  }

  it("still exits after SIGHUP when the stderr summary throws", async () => {
    const cloned = mockClone();
    const runtime = await startTui({
      writeStderr: () => {
        throw new Error("stderr gone");
      },
    });
    await prepareRemote(runtime.controller);

    runtime.fire("SIGHUP");
    expect(await runtime.exited).toBe(129);
    expect(cloned.map(existsSync)).toEqual([false]);
  });

  it("still exits after SIGHUP when final renderer teardown throws", async () => {
    const cloned = mockClone();
    let releaseRun: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      releaseRun = resolve;
      releases.push(resolve);
    });
    const runtime = await startTui({
      runAction: async () => {
        markStarted?.();
        await hold;
      },
    });
    await prepareRemote(runtime.controller);
    const running = runtime.controller.handleEffect({ type: "start", action: "install" });
    await started;

    runtime.fire("SIGHUP");
    runtime.setup.renderer.destroy = () => {
      throw new Error("tty gone");
    };
    releaseRun?.();
    await running;

    expect(await runtime.exited).toBe(129);
    expect(cloned.map(existsSync)).toEqual([false]);
  });

  for (const [signal, repeat, code] of [
    ["SIGHUP", "SIGTERM", 129],
    ["SIGTERM", "SIGHUP", 143],
  ] as const) {
    it(`waits for an in-flight prepare after ${signal} and ${repeat}`, async () => {
      let releasePrepare: (() => void) | undefined;
      let markStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const hold = new Promise<void>((resolve) => {
        releasePrepare = resolve;
        releases.push(resolve);
      });
      const cloned = mockClone(hold, () => markStarted?.());
      const runtime = await startTui();
      const preparing = prepareRemote(runtime.controller);
      await started;

      runtime.fire(signal);
      runtime.fire(repeat);
      await Bun.sleep(0);
      expect(runtime.exitCodes).toEqual([]);
      expect(cloned.map(existsSync)).toEqual([true]);

      releasePrepare?.();
      await preparing;
      expect(await runtime.exited).toBe(code);
      expect(cloned.map(existsSync)).toEqual([false]);
      expect(runtime.exitCodes).toEqual([code]);
    });
  }

  it("waits for a signalled run and disposes its clone once", async () => {
    const cloned = mockClone();
    let releaseRun: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    let markAborted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      markAborted = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      releaseRun = resolve;
      releases.push(resolve);
    });
    const runtime = await startTui({
      runAction: async (_state, _action, _logger, options) => {
        options?.signal?.addEventListener("abort", () => markAborted?.(), { once: true });
        markStarted?.();
        await hold;
      },
    });
    await prepareRemote(runtime.controller);
    const internals = runtime.controller as unknown as { preparedRemote: { cleanup: () => void } };
    const cleanup = internals.preparedRemote.cleanup;
    let cleanupCalls = 0;
    internals.preparedRemote.cleanup = () => {
      cleanupCalls += 1;
      cleanup();
    };
    const running = runtime.controller.handleEffect({ type: "start", action: "install" });
    await started;

    runtime.fire("SIGINT");
    await aborted;
    await Bun.sleep(0);
    expect(runtime.exitCodes).toEqual([]);
    expect(cloned.map(existsSync)).toEqual([true]);

    releaseRun?.();
    await running;
    expect(await runtime.exited).toBe(130);
    expect(cleanupCalls).toBe(1);
    expect(cloned.map(existsSync)).toEqual([false]);
  });

  it("does not tear down twice after two SIGTERMs", async () => {
    const cloned = mockClone();
    let releaseRun: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      releaseRun = resolve;
      releases.push(resolve);
    });
    const runtime = await startTui({
      runAction: async () => {
        markStarted?.();
        await hold;
      },
    });
    await prepareRemote(runtime.controller);
    const internals = runtime.controller as unknown as { preparedRemote: { cleanup: () => void } };
    const cleanup = internals.preparedRemote.cleanup;
    let cleanupCalls = 0;
    internals.preparedRemote.cleanup = () => {
      cleanupCalls += 1;
      cleanup();
    };
    const running = runtime.controller.handleEffect({ type: "start", action: "install" });
    await started;

    runtime.fire("SIGTERM");
    expect(runtime.exitCodes).toEqual([]);
    runtime.fire("SIGTERM");
    expect(await runtime.exited).toBe(143);
    expect(cleanupCalls).toBe(1);

    releaseRun?.();
    await running;
    expect(cleanupCalls).toBe(1);
    expect(runtime.exitCodes).toEqual([143]);
    expect(cloned.map(existsSync)).toEqual([false]);
  });

  it("stops every app repaint once shutdown begins", async () => {
    const cloned = mockClone();
    let releaseRun: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      releaseRun = resolve;
      releases.push(resolve);
    });
    const runtime = await startTui({
      runAction: async (_state, _action, logger) => {
        logger.info("Install summary — installed: []");
        markStarted?.();
        await hold;
      },
    });
    await prepareRemote(runtime.controller);
    const running = runtime.controller.handleEffect({ type: "start", action: "install" });
    await started;

    // The guard sits on `TuiApp.update`, not on the controller: key, input and commit paths reach
    // it without passing through `render`.
    const internals = runtime.controller as unknown as {
      app: { update: () => void; noticeText: { content: unknown } };
    };
    runtime.fire("SIGTERM");
    const painted = String(internals.app.noticeText.content);
    runtime.controller.state.notice = "painted after shutdown began";
    runtime.controller.render();
    internals.app.update();
    await Bun.sleep(250);
    expect(String(internals.app.noticeText.content)).toBe(painted);

    releaseRun?.();
    await running;
    expect(await runtime.exited).toBe(143);
    expect(runtime.stderr).toEqual(["Install summary — installed: []\n"]);
    expect(cloned.map(existsSync)).toEqual([false]);
  });

  it("clears the spinner timer as soon as a signal arrives", async () => {
    mockClone();
    let releaseRun: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      releaseRun = resolve;
      releases.push(resolve);
    });
    const runtime = await startTui({
      runAction: async () => {
        markStarted?.();
        await hold;
      },
    });
    await prepareRemote(runtime.controller);
    const running = runtime.controller.handleEffect({ type: "start", action: "install" });
    await started;
    const internals = runtime.controller as unknown as { spinnerTimer: unknown };
    expect(internals.spinnerTimer).toBeDefined();

    runtime.fire("SIGTERM");
    expect(internals.spinnerTimer).toBeUndefined();

    releaseRun?.();
    await running;
    expect(await runtime.exited).toBe(143);
  });
});
