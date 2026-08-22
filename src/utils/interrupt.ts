/**
 * Ctrl-C handling for runs that may own a temp clone. Lives here rather than next to a command so
 * both `install` and `preset install` import it from the same place.
 */

export interface InterruptGuard {
  /** Threaded through remote-source resolution and install. `undefined` for local-only runs. */
  readonly signal: AbortSignal | undefined;
  /** Marks work that still depends on an owned temporary source. */
  track<T>(work: () => Promise<T>): Promise<T>;
  onCleanup(cleanup: () => void): void;
  /** Runs every cleanup, deregisters, and performs a deferred interrupt exit. Call in `finally`. */
  release(): void;
}

/**
 * Ctrl-C, plus the signals a terminal close or a `kill` sends; all leak a temp clone the same way.
 * SIGABRT, SIGBUS and SIGPIPE are deliberately absent: they are raised by the runtime or ignored by
 * default, and handling them in JS would convert a crash or a closed pipe into a cleanup path that
 * keeps running on a process that is no longer sound.
 */
const TERMINATION_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const;

/**
 * Ctrl-C would otherwise kill the process before a `finally` runs and leak a clone. When `active`,
 * take over the termination signals: abort tracked work and exit only once it has unwound, or
 * clean up and stop the run immediately when nothing is in flight. In the default CLI mode, a
 * second signal force-quits. `handleInterrupt` gives a long-lived owner every signal instead; the
 * TUI deliberately keeps waiting for clone preparation because forced exit would strand it.
 * Local-only runs register nothing and keep the default behaviour.
 */
export function createInterruptGuard(
  active: boolean,
  handleInterrupt?: (signal: (typeof TERMINATION_SIGNALS)[number]) => void,
): InterruptGuard {
  const controller = active ? new AbortController() : undefined;
  const cleanups: (() => void)[] = [];
  let inFlight = 0;
  let interrupted = false;

  const runCleanups = () => {
    while (cleanups.length > 0) {
      try {
        cleanups.pop()!();
      } catch {
        // Best effort. Removing a temp tree can throw (EBUSY/EPERM on Windows, ENOTEMPTY on a
        // network mount), and one such throw must not strand the cleanups still on the stack, skip
        // the signal deregistration in `release`, mask the error already in flight, or - inside a
        // signal handler - surface as an uncaught exception. A wedged directory under the OS temp
        // root is the smaller loss.
      }
    }
  };

  const offInterrupt = () => {
    for (const signal of TERMINATION_SIGNALS) process.off(signal, onInterrupt);
  };

  const onInterrupt = (signal: (typeof TERMINATION_SIGNALS)[number]) => {
    if (handleInterrupt) {
      handleInterrupt(signal);
      return;
    }
    if (controller && inFlight > 0 && !controller.signal.aborted) {
      // Tracked work still depends on a temp source. Abort and let its checkpoints unwind before
      // cleanup removes that source; exiting now would kill the process first.
      controller.abort();
      interrupted = true;
      return;
    }
    // Nothing in flight, or the abort is already out and this is the user asking again. Either way
    // stop here: these handlers cover every termination signal, so ignoring a repeat would leave
    // the process unstoppable short of SIGKILL while a wedged clone times out. A temp directory the
    // clone has not released yet is the accepted cost of the second press.
    interrupted = false; // The exit happens here, so `release` must not repeat it.
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
      // rather than the default one, which would kill the process with a temp root on disk. The
      // `finally` keeps that ordering true even if a cleanup ever escapes `runCleanups`, so a
      // deferred interrupt is never silently dropped and the handlers are never left registered.
      try {
        runCleanups();
      } finally {
        if (controller) offInterrupt();
        // A Ctrl-C during tracked work deferred its exit here, so cleanup has already run.
        if (interrupted) __test.exitOnInterrupt();
      }
    },
  };
}

/**
 * Hand the event loop one turn so a queued signal handler gets to run.
 *
 * The installers are synchronous throughout (`cpSync`, `readdirSync`, `writeFileSync`), so a loop
 * that awaits them awaits already-resolved promises and drains entirely through the microtask
 * queue. A Ctrl-C arriving mid-write is delivered as a macrotask and would not be observed until
 * the whole write phase had finished - which is not what "unwinds between platforms" means. One
 * `setImmediate` per iteration is what puts the abort checkpoints back in reach of the handler.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolveYield) => {
    setImmediate(resolveYield);
  });
}

export const __test = {
  /** Stop the run the way Ctrl-C would. Replaced in tests so an interrupt does not kill the runner. */
  exitOnInterrupt: (): void => {
    process.kill(process.pid, "SIGINT");
  },
};
