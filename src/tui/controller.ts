import type { CliRenderer } from "@opentui/core";

import type { Logger } from "../build.js";
import type { InterruptGuard } from "../utils/interrupt.js";
import { initializeMissingSource, runTuiAction } from "./actions.js";
import { TuiApp } from "./app.js";
import { readClipboardText } from "./clipboard.js";
import { applyFlowPreferences, loadTuiPreferences, saveTuiPreferences, snapshotTuiPreferences } from "./preferences.js";
import { listTuiPresets } from "./presets.js";
import {
  disposePreparedRemote,
  prepareRemoteInstall,
  type PreparedReview,
  type RemoteReviewHost,
} from "./remote-review.js";
import { reviewFingerprint } from "./selectors.js";
import { createInitialState, formatActionTitle, type TuiEffect, type TuiState } from "./state-model.js";

const SPINNER_INTERVAL_MS = 120;
const MAX_RETAINED_LOGS = 80;
// Twice actions.ts's 5s child SIGINT-to-SIGKILL grace. Remote clones have their own 60s timeout;
// shutdown waits for those unbounded so it never strands a partial credential-bearing clone.
const SHUTDOWN_GRACE_MS = 10_000;

export interface TuiControllerOptions {
  /** Overrides process exit so tests can observe the requested code. */
  readonly exit?: (code: number) => void;
  /** Overrides stderr writes so tests can observe the final shutdown summary. */
  readonly writeStderr?: (message: string) => void;
  /** Overrides the graceful shutdown bound for deterministic controller tests. */
  readonly shutdownGraceMs?: number;
  /**
   * Teardown hooks owned by the Bun TUI entrypoint. Only the cleanup stack and release are handed
   * over: in delegating mode the guard's own abort signal never fires, so threading it into remote
   * resolution here would look like cancellation and silently do nothing.
   */
  readonly interruptGuard?: Pick<InterruptGuard, "onCleanup" | "release">;
  /** Overrides preset discovery; defaults to scanning the real preset roots. */
  readonly listPresets?: typeof listTuiPresets;
  /** Overrides clipboard reads for the explicit Ctrl+V paste path. */
  readonly readClipboard?: () => string;
  /** Overrides where `.ulis-tui.json` is read from and written to. */
  readonly preferencesPath?: string;
  /** Overrides workflow execution for deterministic controller tests. */
  readonly runAction?: typeof runTuiAction;
  /** Overrides source initialization for deterministic controller tests. */
  readonly initializeSource?: typeof initializeMissingSource;
  /** Overrides the working directory shown in rendered plans. */
  readonly cwd?: string;
  /** Overrides the home directory used in rendered plans and workflow execution. */
  readonly userHome?: string;
}

/**
 * Owns TUI state, workflow execution, and preference persistence.
 *
 * The renderer is injected so the same controller drives both the real terminal
 * and the `@opentui/core/testing` harness.
 */
export class TuiController {
  readonly state: TuiState;
  private readonly renderer: CliRenderer;
  private readonly options: TuiControllerOptions;
  private readonly app: TuiApp;

  private readonly canSavePreferences: boolean;
  private lastSavedPreferences: string;
  private runAbortController: AbortController | undefined;
  private runPromise: Promise<void> | undefined;
  private lastRunOutcome: "ok" | "stopped" | "failed" | undefined;
  private shutdownStarted = false;
  private shutdownFinished = false;
  private shutdownCode = 0;
  /** Clone backing the review screen. Reused by the install so what ran is what was shown. */
  private preparedRemote: PreparedReview | undefined;
  private prepareGeneration = 0;
  private prepareAbort: AbortController | undefined;
  /**
   * Every in-flight preparation, so shutdown waits for each clone to be cleaned up. Superseded
   * preparations stay here until they settle: their `inFlightCleanups` entry is still empty while
   * the clone is running, so exiting on the newest one alone would strand the older temp root.
   */
  private readonly preparePromises = new Set<Promise<void>>();
  private readonly inFlightCleanups = new Set<() => void>();
  private spinnerTimer: ReturnType<typeof setInterval> | undefined;

  constructor(renderer: CliRenderer, options: TuiControllerOptions = {}) {
    this.renderer = renderer;
    this.options = options;

    this.state = createInitialState();
    this.state.availablePresets = (options.listPresets ?? listTuiPresets)({ cwd: options.cwd });
    const loadedPreferences = loadTuiPreferences(this.state, options.preferencesPath);
    this.canSavePreferences = loadedPreferences.canSave;
    if (loadedPreferences.notice) this.state.notice = loadedPreferences.notice;
    this.lastSavedPreferences = JSON.stringify(snapshotTuiPreferences(this.state));

    this.app = new TuiApp(renderer, {
      state: this.state,
      onEffect: (effect) => void this.handleEffect(effect),
      onStateChanged: () => this.persistPreferences(),
      readClipboard: options.readClipboard ?? readClipboardText,
      cwd: options.cwd,
      userHome: options.userHome,
    });
    if (options.interruptGuard) {
      options.interruptGuard.onCleanup(() => this.renderer.destroy());
      options.interruptGuard.onCleanup(() => this.app.destroy());
      options.interruptGuard.onCleanup(() => this.clearSpinner());
      options.interruptGuard.onCleanup(() => disposePreparedRemote(this.remoteReviewHost()));
      options.interruptGuard.onCleanup(() => {
        for (const cleanup of [...this.inFlightCleanups]) {
          try {
            cleanup();
          } catch {}
        }
        this.inFlightCleanups.clear();
      });
    }
  }

  /** Re-renders the current state. */
  render(): void {
    this.app.update();
  }

  async handleEffect(effect: TuiEffect): Promise<void> {
    if (effect.discardRemoteReview) disposePreparedRemote(this.remoteReviewHost());
    if (effect.type === "none") return;

    if (effect.type === "exit") {
      await this.shutdown(effect.code);
      return;
    }

    if (effect.type === "cancelRunning") {
      if (this.prepareAbort != null) {
        this.pushLog("[warn] Stopping remote fetch...");
        this.prepareAbort.abort();
        return;
      }
      if (this.runAbortController == null) return;
      this.pushLog("[warn] Stopping current workflow...");
      this.runAbortController.abort();
      return;
    }

    if (effect.type === "pasteClipboard") {
      this.app.pasteFromClipboard();
      return;
    }

    if (effect.type === "prepareRemoteInstall") {
      const running = prepareRemoteInstall(this.remoteReviewHost(), effect.action);
      this.preparePromises.add(running);
      try {
        await running;
      } finally {
        this.preparePromises.delete(running);
      }
      return;
    }

    if (effect.type === "initSource") {
      const pendingAction = this.state.pendingAction;
      this.state.pendingAction = undefined;
      const title =
        pendingAction == null ? "Initialize source" : `Initialize source and ${formatActionTitle(pendingAction)}`;
      const successMessage =
        pendingAction == null
          ? "Source initialized successfully."
          : `Source initialized and ${formatActionTitle(pendingAction)} completed successfully.`;
      await this.runWithLogs(title, successMessage, async (logger, signal) => {
        await (this.options.initializeSource ?? initializeMissingSource)(this.state, logger);
        if (pendingAction != null) {
          await (this.options.runAction ?? runTuiAction)(this.state, pendingAction, logger, {
            signal,
            cwd: this.options.cwd,
            userHome: this.options.userHome,
          });
        }
      });
      return;
    }

    if (effect.type === "loadCustomPresetSource") {
      this.state.availablePresets = (this.options.listPresets ?? listTuiPresets)({
        cwd: this.options.cwd,
        customRoot: effect.path,
      });
      applyFlowPreferences(this.state, "presetsOnly", true);
      if (!this.state.availablePresets.some((preset) => preset.source === "custom")) {
        this.state.notice = `No presets found in custom directory: ${effect.path}`;
      }
      this.persistPreferences();
      this.render();
      return;
    }

    // Only the start this review was made for may consume it. A prepared clone must never leak
    // into a different action or a plan that has since been edited.
    const prepared =
      this.preparedRemote?.action === effect.action &&
      this.preparedRemote.fingerprint ===
        reviewFingerprint(this.state, this.preparedRemote.action, this.options.cwd, this.options.userHome)
        ? this.preparedRemote
        : undefined;
    if (this.preparedRemote && !prepared) disposePreparedRemote(this.remoteReviewHost());
    try {
      await this.runWithLogs(
        formatActionTitle(effect.action),
        `${formatActionTitle(effect.action)} completed successfully.`,
        (logger, signal) =>
          (this.options.runAction ?? runTuiAction)(this.state, effect.action, logger, {
            signal,
            prepared,
            cwd: this.options.cwd,
            userHome: this.options.userHome,
          }),
      );
    } finally {
      disposePreparedRemote(this.remoteReviewHost());
    }
  }

  private async runWithLogs(
    title: string,
    successMessage: string,
    run: (logger: Logger, signal: AbortSignal) => void | Promise<void>,
  ): Promise<void> {
    const abortController = new AbortController();
    this.runAbortController = abortController;
    this.state.logs = [`Starting: ${title}`];
    this.state.notice = "";
    this.state.resultTitle = "";
    this.state.resultMessage = "";
    this.state.screen = "running";
    this.state.runningSpinnerFrame = 0;
    this.render();

    this.startSpinner();

    const running = (async () => run(this.createLogger(), abortController.signal))();
    this.runPromise = running;
    try {
      await running;
      this.lastRunOutcome = "ok";
      this.state.resultTitle = `${title} Complete`;
      this.state.resultMessage = successMessage;
    } catch (error) {
      if (abortController.signal.aborted) {
        this.lastRunOutcome = "stopped";
        this.state.resultTitle = `${title} Stopped`;
        this.state.resultMessage = `${title} stopped by user.`;
        this.pushLog(`[warn] ${this.state.resultMessage}`);
      } else {
        this.lastRunOutcome = "failed";
        this.state.resultTitle = `${title} Failed`;
        this.state.resultMessage = error instanceof Error ? error.message : String(error);
        this.pushLog(`[error] ${this.state.resultMessage}`);
      }
    } finally {
      if (this.runAbortController === abortController) this.runAbortController = undefined;
      if (this.runPromise === running) this.runPromise = undefined;
      this.clearSpinner();
      this.state.screen = "result";
      this.render();
    }
  }

  private createLogger(): Logger {
    return {
      header: (message) => this.pushLog(`=== ${message} ===`),
      info: (message) => this.pushLog(`[info] ${message}`),
      success: (message) => this.pushLog(`[done] ${message}`),
      warn: (message) => this.pushLog(`[warn] ${message}`),
      error: (message) => this.pushLog(`[error] ${message}`),
      dim: (message) => this.pushLog(`      ${message}`),
    };
  }

  private pushLog(message: string): void {
    this.state.logs = [...this.state.logs, message].slice(-MAX_RETAINED_LOGS);
    this.render();
  }

  private persistPreferences(): void {
    const nextSnapshot = JSON.stringify(snapshotTuiPreferences(this.state));
    if (nextSnapshot === this.lastSavedPreferences) return;
    if (!this.canSavePreferences) {
      this.state.notice ||= "Preferences are newer than this ULIS; changes are not being saved.";
      return;
    }

    const error = saveTuiPreferences(this.state, this.options.preferencesPath);
    if (error == null) {
      this.lastSavedPreferences = nextSnapshot;
      return;
    }
    this.state.notice = error;
  }

  private startSpinner(): void {
    this.clearSpinner();
    this.spinnerTimer = setInterval(() => {
      if (this.state.screen !== "running") return;
      this.state.runningSpinnerFrame = (this.state.runningSpinnerFrame + 1) % 4;
      this.render();
    }, SPINNER_INTERVAL_MS);
  }

  private clearSpinner(): void {
    if (this.spinnerTimer == null) return;
    clearInterval(this.spinnerTimer);
    this.spinnerTimer = undefined;
  }

  /**
   * Adapts this controller to {@link RemoteReviewHost}, the contract `remote-review.ts` prepares
   * and disposes reviews through. `preparedRemote`/`prepareGeneration`/`prepareAbort` are get/set
   * pairs closing over this controller's own private fields, so a write through the host writes
   * the fields `controller.test.ts` reflects into directly.
   */
  private remoteReviewHost(): RemoteReviewHost {
    const self = this;
    return {
      // Captured values, not accessors like the three below - safe only because `state` is
      // `readonly` (its properties mutate in place, so the same object stays current) and
      // `options` is `private readonly` with fields nothing reassigns. If either ever becomes
      // reassignable, this host goes stale and must switch to a getter too.
      state: this.state,
      cwd: this.options.cwd,
      userHome: this.options.userHome,
      get preparedRemote() {
        return self.preparedRemote;
      },
      set preparedRemote(value) {
        self.preparedRemote = value;
      },
      get prepareGeneration() {
        return self.prepareGeneration;
      },
      set prepareGeneration(value) {
        self.prepareGeneration = value;
      },
      get prepareAbort() {
        return self.prepareAbort;
      },
      set prepareAbort(value) {
        self.prepareAbort = value;
      },
      render: () => this.render(),
      createLogger: () => this.createLogger(),
      startSpinner: () => this.startSpinner(),
      clearSpinner: () => this.clearSpinner(),
      trackCleanup: (cleanup) => {
        this.inFlightCleanups.add(cleanup);
      },
      untrackCleanup: (cleanup) => {
        this.inFlightCleanups.delete(cleanup);
      },
    };
  }

  /** Tears the UI down and exits. Exposed for tests through `options.exit`. */
  async shutdown(code: number): Promise<void> {
    this.clearSpinner();
    if (this.shutdownStarted) {
      if (this.preparePromises.size === 0) this.finishShutdown();
      return;
    }

    this.shutdownStarted = true;
    this.app.freeze();
    const run = this.runPromise;
    const incomplete =
      run != null ||
      this.preparePromises.size > 0 ||
      this.lastRunOutcome === "stopped" ||
      this.lastRunOutcome === "failed";
    // `q` (code 0) with work still unfinished exits 1, and that first code stands: a signal
    // arriving later reports the interrupted quit, not its own 128 + n.
    this.shutdownCode = code === 0 && incomplete ? 1 : code;
    this.runAbortController?.abort();
    this.prepareAbort?.abort();

    // Aborting only starts clone teardown. The resolver owns the temp root until it returns, so a
    // timeout or second Ctrl+C here could strand a partial clone containing credentials.
    if (this.preparePromises.size > 0) await Promise.allSettled([...this.preparePromises]);

    if (run) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled([run]),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, this.options.shutdownGraceMs ?? SHUTDOWN_GRACE_MS);
        }),
      ]);
      if (timeout != null) clearTimeout(timeout);
    }

    this.finishShutdown();
  }

  private finishShutdown(): void {
    if (this.shutdownFinished) return;
    this.shutdownFinished = true;
    if (this.options.interruptGuard) {
      this.options.interruptGuard.release();
    } else {
      for (const cleanup of [...this.inFlightCleanups]) cleanup();
      this.inFlightCleanups.clear();
      disposePreparedRemote(this.remoteReviewHost());
      this.clearSpinner();
      this.app.destroy();
      this.renderer.destroy();
    }
    if (this.shutdownCode !== 0) {
      const summary = [...this.state.logs]
        .reverse()
        .find((line) => line.includes("Install summary"))
        ?.replace(/^\[[^\]]+\]\s*/u, "");
      const message = summary || this.state.resultMessage || this.state.notice || "ULIS workflow interrupted.";
      const writeStderr = this.options.writeStderr ?? ((value: string) => process.stderr.write(value));
      try {
        writeStderr(`${message}\n`);
      } catch {}
    }
    const exit = this.options.exit ?? ((value: number) => process.exit(value));
    exit(this.shutdownCode);
  }
}
