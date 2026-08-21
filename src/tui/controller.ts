import type { CliRenderer } from "@opentui/core";

import type { Logger } from "../build.js";
import { planRemoteCommands } from "../install.js";
import type { Platform } from "../platforms.js";
import type { InterruptGuard } from "../utils/interrupt.js";
import { sanitizeConsentText } from "../utils/redact.js";
import { resolvePresets, type ResolvedPreset } from "../utils/resolve-presets.js";
import { resolveSourceOrRemote } from "../utils/resolve-source.js";
import { initializeMissingSource, runTuiAction } from "./actions.js";
import { TuiApp } from "./app.js";
import { readClipboardText } from "./clipboard.js";
import { loadTuiPreferences, saveTuiPreferences, snapshotTuiPreferences } from "./preferences.js";
import { listTuiPresets } from "./presets.js";
import {
  applyFlowPreferences,
  createInitialState,
  planSource,
  remotePresetRef,
  reviewFingerprint,
  selectedPresets,
  PRESET_INSTALL_REVIEW_START_ROW,
  type PlannedSource,
  type PreparedRemoteInstall,
  type TuiEffect,
  type TuiScreen,
  type TuiState,
} from "./state.js";

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

type ActionTitleKey = Exclude<TuiEffect & { type: "start" }, never>["action"];

/**
 * A prepared review plus the bookkeeping only the controller needs: what was fetched, so a review
 * regenerated for the same remote can reuse the clone instead of going back to the network.
 */
interface PreparedReview extends PreparedRemoteInstall {
  /** Identity of the fetch itself. Options change the command list, not the tree it is read from. */
  readonly cloneKey: string;
  readonly remotePresets: readonly ResolvedPreset[];
}

/** Everything the command list is planned from, captured at the same instant as the fingerprint. */
interface PrepareSnapshot {
  readonly fingerprint: string;
  readonly platforms: readonly Platform[];
  readonly presetInstallExtensions: boolean;
  readonly skipExternalSkills: boolean;
  readonly localPresets: readonly ResolvedPreset[];
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
      options.interruptGuard.onCleanup(() => this.disposePreparedRemote());
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
    if (effect.discardRemoteReview) this.disposePreparedRemote();
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
      const running = this.prepareRemoteInstall(effect.action);
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
    if (this.preparedRemote && !prepared) this.disposePreparedRemote();
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
      this.disposePreparedRemote();
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

  /** Tears the UI down and exits. Exposed for tests through `options.exit`. */
  /**
   * Clone the remote source (and/or preset ref) so the review screen can list the exact commands it
   * will run. The clone is kept and handed to the install, so consent applies to what executes.
   */
  private async prepareRemoteInstall(action: "install" | "presetInstall"): Promise<void> {
    const plan = planSource(this.state, this.options.cwd, this.options.userHome);
    const remoteRef = remotePresetRef(this.state);
    // `action` rides along even though `publishReview` replans for whichever action is asked for:
    // it costs one string and removes any need to reason about cross-action reuse at all.
    const cloneKey = JSON.stringify([action, plan.remote ? plan.sourceDir : "", remoteRef ?? "", plan.globalInstall]);

    // The review screen's own toggles are part of the fingerprint, so using them has to regenerate
    // the review. They change the command list, never the tree it is planned from, so replan from
    // the clone already on disk rather than putting a network round trip behind every checkbox.
    if (this.prepareAbort == null && this.preparedRemote?.cloneKey === cloneKey) {
      const reused = this.preparedRemote;
      this.publishReview(action, plan, remoteRef, cloneKey, this.snapshotPrepareInputs(action), {
        sourceDir: reused.sourceDir,
        remotePresets: reused.remotePresets,
        cleanup: reused.cleanup,
      });
      this.render();
      return;
    }

    // One preparation at a time: a second one must not overwrite the first's clone without
    // disposing it, and a completion that arrives after being superseded must throw its own away.
    this.prepareAbort?.abort();
    this.disposePreparedRemote();
    const generation = ++this.prepareGeneration;
    const abort = new AbortController();
    this.prepareAbort = abort;

    // Snapshot every input the command list depends on at the same instant as the fingerprint.
    // Reading them back after the awaits would let a change made during the clone (and reverted
    // afterwards) produce a review that omits commands the matching fingerprint then permits.
    const snapshot = this.snapshotPrepareInputs(action);
    const cleanups: (() => void)[] = [];
    const disposeAll = () => {
      while (cleanups.length > 0) cleanups.pop()!();
    };
    // Visible to shutdown, so an in-flight clone is never stranded on disk.
    this.inFlightCleanups.add(disposeAll);

    // Fetching is a network operation, so it gets the same running screen as every other long
    // operation: progress is visible, its logs stream, `q` cancels it, and - because that screen
    // takes no editing keys - the plan cannot drift out from under the review being prepared.
    const title = action === "install" ? "Fetch remote source" : "Fetch remote presets";
    // A superseded preparation inherits the running screen; the plan screen is the only way in.
    const originScreen: TuiScreen = this.state.screen === "running" ? "plan" : this.state.screen;
    this.state.notice = "";
    this.state.logs = [`Starting: ${title}`];
    this.state.screen = "running";
    this.state.runningSpinnerFrame = 0;
    this.startSpinner();
    this.render();

    try {
      const source = plan.remote
        ? await resolveSourceOrRemote({
            source: plan.sourceDir,
            global: plan.globalInstall,
            logger: this.createLogger(),
            signal: abort.signal,
          })
        : undefined;
      if (source) cleanups.push(source.cleanup);

      const remote = remoteRef
        ? await resolvePresets([remoteRef], {
            nonInteractive: true,
            logger: this.createLogger(),
            signal: abort.signal,
          })
        : undefined;
      if (remote) cleanups.push(remote.cleanup);

      if (generation !== this.prepareGeneration) {
        // Superseded while cloning: this result is stale, so discard it rather than publish it.
        disposeAll();
        return;
      }
      // Cancelled mid-clone: keep the result off the screen as well as off the disk.
      if (abort.signal.aborted) throw new Error(`${title} stopped by user.`);

      this.clearSpinner();
      this.publishReview(action, plan, remoteRef, cloneKey, snapshot, {
        sourceDir: source?.sourceDir,
        remotePresets: remote?.presets ?? [],
        cleanup: disposeAll,
      });
    } catch (error) {
      disposeAll();
      if (generation !== this.prepareGeneration) return;
      this.clearSpinner();
      // A failed clone is a notice, never a crash.
      this.state.screen = originScreen;
      this.state.notice = abort.signal.aborted
        ? `${title} stopped by user.`
        : error instanceof Error
          ? error.message
          : String(error);
      this.state.remoteCommands = [];
      this.state.remoteCommandSource = "";
    } finally {
      this.inFlightCleanups.delete(disposeAll);
      if (this.prepareAbort === abort) this.prepareAbort = undefined;
    }
    this.render();
  }

  private snapshotPrepareInputs(action: "install" | "presetInstall"): PrepareSnapshot {
    return {
      fingerprint: reviewFingerprint(this.state, action, this.options.cwd, this.options.userHome),
      platforms: [...this.state.platforms],
      presetInstallExtensions: this.state.presetInstallExtensions,
      skipExternalSkills: this.state.skipExternalSkills,
      localPresets: selectedPresets(this.state),
    };
  }

  /** Plan the command list from an already-resolved clone and show it on the review screen. */
  private publishReview(
    action: "install" | "presetInstall",
    plan: PlannedSource,
    remoteRef: string | undefined,
    cloneKey: string,
    snapshot: PrepareSnapshot,
    clone: { sourceDir?: string; remotePresets: readonly ResolvedPreset[]; cleanup: () => void },
  ): void {
    const presets = [...snapshot.localPresets, ...clone.remotePresets];
    const commands = planRemoteCommands({
      sourceDir: action === "install" ? (clone.sourceDir ?? plan.sourceDir) : undefined,
      presets,
      platforms: snapshot.platforms,
      destBase: plan.destBase,
      userHome: this.options.userHome,
      globalInstall: plan.globalInstall,
      installExtensions: action === "presetInstall" ? snapshot.presetInstallExtensions : true,
      installSkills: !snapshot.skipExternalSkills,
    });

    this.preparedRemote = {
      action,
      fingerprint: snapshot.fingerprint,
      cloneKey,
      sourceDir: clone.sourceDir,
      remotePresets: clone.remotePresets,
      presets,
      commands,
      cleanup: clone.cleanup,
    };
    this.state.remoteCommands = commands;
    this.state.remoteCommandSource = sanitizeConsentText(plan.remote ? plan.sourceDir : (remoteRef ?? ""));

    const screen = action === "install" ? "installReview" : "presetInstallReview";
    if (this.state.screen !== screen) {
      this.state.screen = screen;
      // Land on "Start", never on a toggle: a confirming Enter must not flip an option instead.
      this.state.cursor = action === "install" ? 0 : PRESET_INSTALL_REVIEW_START_ROW;
    }
  }

  private disposePreparedRemote(): void {
    this.preparedRemote?.cleanup();
    this.preparedRemote = undefined;
    this.state.remoteCommands = [];
    this.state.remoteCommandSource = "";
  }

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
      this.disposePreparedRemote();
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

export function formatActionTitle(action: ActionTitleKey): string {
  if (action === "validate") return "Validate";
  if (action === "presetValidate") return "Preset Validate";
  if (action === "build") return "Build";
  if (action === "presetInstall") return "Preset Install";
  return "Install";
}
