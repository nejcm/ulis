import { describe, expect, it } from "bun:test";

import { createInterruptGuard, __test } from "./interrupt.js";

/** Fire the handler the guard registered, without raising a real signal. */
function fireSignal(signal: NodeJS.Signals): void {
  (process.listeners(signal).at(-1) as ((value: string) => void) | undefined)?.(signal);
}

function pressCtrlC(): void {
  fireSignal("SIGINT");
}

/** Record interrupt exits instead of stopping the test runner. */
function captureExit(): { exits: number; restore: () => void } {
  const original = __test.exitOnInterrupt;
  const state = { exits: 0, restore: () => void (__test.exitOnInterrupt = original) };
  __test.exitOnInterrupt = () => void (state.exits += 1);
  return state;
}

describe("createInterruptGuard", () => {
  // Removing a temp tree throws often enough to matter (EBUSY/EPERM on Windows, ENOTEMPTY on a
  // network mount), and `installCmd` registers two cleanups. Before this was isolated, the first
  // throw stranded the second, skipped `offInterrupt` (leaking three process listeners) and
  // dropped a deferred interrupt exit.
  it("runs every cleanup and still deregisters when one throws", () => {
    const before = process.listenerCount("SIGINT");
    const guard = createInterruptGuard(true);
    const ran: string[] = [];
    guard.onCleanup(() => ran.push("first registered"));
    guard.onCleanup(() => {
      throw new Error("EBUSY: resource busy or locked");
    });

    expect(() => guard.release()).not.toThrow();

    expect(ran).toEqual(["first registered"]);
    expect(process.listenerCount("SIGINT")).toBe(before);
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });

  it("still performs a deferred interrupt exit when a cleanup throws", async () => {
    const exit = captureExit();
    const guard = createInterruptGuard(true);
    guard.onCleanup(() => {
      throw new Error("ENOTEMPTY: directory not empty");
    });

    try {
      await guard.track(async () => void pressCtrlC());
      expect(guard.signal?.aborted).toBe(true);
      expect(exit.exits).toBe(0); // deferred until the in-flight work unwound

      guard.release();
      expect(exit.exits).toBe(1);
    } finally {
      exit.restore();
    }
  });

  // The handlers cover every termination signal, so a swallowed repeat leaves the process
  // stoppable only by SIGKILL while a wedged clone runs down its timeout.
  it("force-quits on a second interrupt while the first is still unwinding", async () => {
    const before = process.listenerCount("SIGINT");
    const exit = captureExit();
    const guard = createInterruptGuard(true);
    guard.onCleanup(() => undefined);

    try {
      await guard.track(async () => {
        pressCtrlC(); // aborts the in-flight work
        pressCtrlC(); // force quit
      });

      expect(exit.exits).toBe(1);
      expect(process.listenerCount("SIGINT")).toBe(before);

      // The exit already happened; `release` must not exit a second time.
      guard.release();
      expect(exit.exits).toBe(1);
    } finally {
      exit.restore();
    }
  });

  // Without the early return the delegating branch falls through to the default handler, which
  // aborts and exits the process behind the owner's back.
  it("delegates every termination signal instead of aborting or exiting", () => {
    const exit = captureExit();
    const signals: string[] = [];
    const guard = createInterruptGuard(true, (signal) => signals.push(signal));

    try {
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const) fireSignal(signal);
      expect(signals).toEqual(["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"]);
      expect(guard.signal?.aborted).toBe(false);
      expect(exit.exits).toBe(0);
    } finally {
      guard.release();
      exit.restore();
    }
  });

  it("registers nothing for a local-only run", () => {
    const before = process.listenerCount("SIGINT");
    const guard = createInterruptGuard(false);

    expect(guard.signal).toBeUndefined();
    expect(process.listenerCount("SIGINT")).toBe(before);
    guard.release();
  });
});
