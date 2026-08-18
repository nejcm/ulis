/**
 * Ctrl-C handling for runs that may own a temp clone. Lives here rather than next to a command so
 * both `install` and `preset install` import it from the same place.
 */

export interface InterruptGuard {
  /** Threaded into anything that clones, so Ctrl-C can abort it. `undefined` for local-only runs. */
  readonly signal: AbortSignal | undefined;
  /** Marks work that may own a not-yet-published temp directory (i.e. an in-flight clone). */
  track<T>(work: () => Promise<T>): Promise<T>;
  onCleanup(cleanup: () => void): void;
  /** Runs every cleanup, deregisters, and performs a deferred interrupt exit. Call in `finally`. */
  release(): void;
}

/** Ctrl-C, plus the signals a terminal close or a `kill` sends; all leak a temp clone the same way. */
const TERMINATION_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/**
 * Ctrl-C would otherwise kill the process before a `finally` runs and leak a clone. When `active`,
 * take over the termination signals: abort an in-flight clone and exit only once it has unwound, or
 * clean up and stop the run immediately when nothing is in flight. Local-only runs register nothing
 * and keep the default behaviour.
 */
export function createInterruptGuard(active: boolean): InterruptGuard {
  const controller = active ? new AbortController() : undefined;
  const cleanups: (() => void)[] = [];
  let inFlight = 0;
  let interrupted = false;

  const runCleanups = () => {
    while (cleanups.length > 0) cleanups.pop()!();
  };

  const offInterrupt = () => {
    for (const signal of TERMINATION_SIGNALS) process.off(signal, onInterrupt);
  };

  const onInterrupt = () => {
    if (controller && inFlight > 0) {
      // A clone is running and still owns a temp directory nobody else can see. Aborting kills git
      // and lets fetchRemoteSource remove it; exiting now would kill the process first.
      if (!controller.signal.aborted) controller.abort();
      interrupted = true;
      return;
    }
    // Nothing in flight: nothing downstream listens to the abort, so stop the run here.
    runCleanups();
    offInterrupt();
    __test.exitOnInterrupt();
  };
  if (controller) for (const signal of TERMINATION_SIGNALS) process.on(signal, onInterrupt);

  return {
    signal: controller?.signal,
    async track(work) {
      inFlight += 1;
      try {
        return await work();
      } finally {
        inFlight -= 1;
      }
    },
    onCleanup(cleanup) {
      cleanups.push(cleanup);
    },
    release() {
      // Delete first, deregister second: a Ctrl-C landing in between must still reach our handler
      // rather than the default one, which would kill the process with a temp root on disk.
      runCleanups();
      if (controller) offInterrupt();
      // A Ctrl-C that landed mid-clone deferred its exit to here, so cleanup has already run.
      if (interrupted) __test.exitOnInterrupt();
    },
  };
}

export const __test = {
  /** Stop the run the way Ctrl-C would. Replaced in tests so an interrupt does not kill the runner. */
  exitOnInterrupt: (): void => {
    process.kill(process.pid, "SIGINT");
  },
};
