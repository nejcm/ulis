import type { CliRenderer } from "@opentui/core";

import type { Logger } from "../build.js";
import { initializeMissingSource, runTuiAction } from "./actions.js";
import { TuiApp } from "./app.js";
import { readClipboardText } from "./clipboard.js";
import { loadTuiPreferences, saveTuiPreferences, snapshotTuiPreferences } from "./preferences.js";
import { listTuiPresets } from "./presets.js";
import { applyFlowPreferences, createInitialState, type TuiEffect, type TuiState } from "./state.js";

const SPINNER_INTERVAL_MS = 120;
const MAX_RETAINED_LOGS = 80;

export interface TuiControllerOptions {
  /** Overrides process exit so tests can observe the requested code. */
  readonly exit?: (code: number) => void;
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
}

type ActionTitleKey = Exclude<TuiEffect & { type: "start" }, never>["action"];

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

  private lastSavedPreferences: string;
  private runAbortController: AbortController | undefined;
  private spinnerTimer: ReturnType<typeof setInterval> | undefined;

  constructor(renderer: CliRenderer, options: TuiControllerOptions = {}) {
    this.renderer = renderer;
    this.options = options;

    this.state = createInitialState();
    this.state.availablePresets = (options.listPresets ?? listTuiPresets)({ cwd: options.cwd });
    const loadError = loadTuiPreferences(this.state, options.preferencesPath);
    if (loadError) this.state.notice = loadError;
    this.lastSavedPreferences = JSON.stringify(snapshotTuiPreferences(this.state));

    this.app = new TuiApp(renderer, {
      state: this.state,
      onEffect: (effect) => void this.handleEffect(effect),
      onStateChanged: () => this.persistPreferences(),
      readClipboard: options.readClipboard ?? readClipboardText,
      cwd: options.cwd,
    });
  }

  /** Re-renders the current state. */
  render(): void {
    this.app.update();
  }

  async handleEffect(effect: TuiEffect): Promise<void> {
    if (effect.type === "none") return;

    if (effect.type === "exit") {
      this.shutdown(effect.code);
      return;
    }

    if (effect.type === "cancelRunning") {
      if (this.runAbortController == null) return;
      this.pushLog("[warn] Stopping current workflow...");
      this.runAbortController.abort();
      return;
    }

    if (effect.type === "pasteClipboard") {
      this.app.pasteFromClipboard();
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
          await (this.options.runAction ?? runTuiAction)(this.state, pendingAction, logger, { signal });
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

    await this.runWithLogs(
      formatActionTitle(effect.action),
      `${formatActionTitle(effect.action)} completed successfully.`,
      (logger, signal) => (this.options.runAction ?? runTuiAction)(this.state, effect.action, logger, { signal }),
    );
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

    this.spinnerTimer = setInterval(() => {
      if (this.state.screen !== "running") return;
      this.state.runningSpinnerFrame = (this.state.runningSpinnerFrame + 1) % 4;
      this.render();
    }, SPINNER_INTERVAL_MS);

    try {
      await run(this.createLogger(), abortController.signal);
      this.state.resultTitle = `${title} Complete`;
      this.state.resultMessage = successMessage;
    } catch (error) {
      if (abortController.signal.aborted) {
        this.state.resultTitle = `${title} Stopped`;
        this.state.resultMessage = `${title} stopped by user.`;
        this.pushLog(`[warn] ${this.state.resultMessage}`);
      } else {
        this.state.resultTitle = `${title} Failed`;
        this.state.resultMessage = error instanceof Error ? error.message : String(error);
        this.pushLog(`[error] ${this.state.resultMessage}`);
      }
    } finally {
      if (this.runAbortController === abortController) this.runAbortController = undefined;
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

    const error = saveTuiPreferences(this.state, this.options.preferencesPath);
    if (error == null) {
      this.lastSavedPreferences = nextSnapshot;
      return;
    }
    this.state.notice = error;
  }

  private clearSpinner(): void {
    if (this.spinnerTimer == null) return;
    clearInterval(this.spinnerTimer);
    this.spinnerTimer = undefined;
  }

  /** Tears the UI down and exits. Exposed for tests through `options.exit`. */
  shutdown(code: number): void {
    this.runAbortController?.abort();
    this.runAbortController = undefined;
    this.clearSpinner();
    this.app.destroy();
    this.renderer.destroy();
    const exit = this.options.exit ?? ((value: number) => process.exit(value));
    exit(code);
  }
}

export function formatActionTitle(action: ActionTitleKey): string {
  if (action === "validate") return "Validate";
  if (action === "presetValidate") return "Preset Validate";
  if (action === "build") return "Build";
  if (action === "presetInstall") return "Preset Install";
  return "Install";
}
