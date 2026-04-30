import { ProcessTerminal, VStack, cel } from "@cel-tui/core";

import type { Logger } from "./build.js";
import { listPresets } from "./presets.js";
import { initializeMissingSource, runTuiAction } from "./tui/actions.js";
import { renderScreen } from "./tui/render.js";
import { createInitialState, handleTuiKey, type TuiState } from "./tui/state.js";

const state: TuiState = createInitialState();

function main(): void {
  state.availablePresets = listPresets();
  cel.init(new ProcessTerminal());
  cel.viewport(renderApp);
}

function renderApp() {
  return VStack(
    {
      width: "100%",
      height: "100%",
      padding: { x: 1, y: 1 },
      justifyContent: "start",
      alignItems: "start",
      overflow: "scroll",
      scrollbar: true,
      fgColor: "color07",
      focusable: true,
      onKeyPress: (key) => {
        const effect = handleTuiKey(state, key);
        cel.render();
        void handleEffect(effect);
      },
    },
    [renderScreen(state)],
  );
}

async function handleEffect(effect: ReturnType<typeof handleTuiKey>): Promise<void> {
  if (effect.type === "none") return;
  if (effect.type === "exit") {
    exitApp(effect.code);
    return;
  }

  if (effect.type === "initSource") {
    const pendingAction = state.pendingAction;
    state.pendingAction = undefined;
    const title =
      pendingAction == null ? "Initialize source" : `Initialize source and ${formatActionTitle(pendingAction)}`;
    const successMessage =
      pendingAction == null
        ? "Source initialized successfully."
        : `Source initialized and ${formatActionTitle(pendingAction)} completed successfully.`;
    await runWithLogs(title, successMessage, async (logger) => {
      await initializeMissingSource(state, logger);
      if (pendingAction != null) await runTuiAction(state, pendingAction, logger);
    });
    return;
  }

  await runWithLogs(
    formatActionTitle(effect.action),
    `${formatActionTitle(effect.action)} completed successfully.`,
    (logger) => {
      return runTuiAction(state, effect.action, logger);
    },
  );
}

async function runWithLogs(
  title: string,
  successMessage: string,
  run: (logger: Logger) => void | Promise<void>,
): Promise<void> {
  state.logs = [`Starting: ${title}`];
  state.notice = "";
  state.resultTitle = "";
  state.resultMessage = "";
  state.screen = "running";
  state.runningSpinnerFrame = 0;
  cel.render();
  const spinnerInterval = setInterval(() => {
    if (state.screen !== "running") return;
    state.runningSpinnerFrame = (state.runningSpinnerFrame + 1) % 4;
    cel.render();
  }, 120);

  try {
    await run(createUiLogger());
    state.resultTitle = `${title} Complete`;
    state.resultMessage = successMessage;
  } catch (error) {
    state.resultTitle = `${title} Failed`;
    state.resultMessage = error instanceof Error ? error.message : String(error);
    pushLog(`[error] ${state.resultMessage}`);
  } finally {
    clearInterval(spinnerInterval);
    state.screen = "result";
    cel.render();
  }
}

function createUiLogger(): Logger {
  return {
    header: (message) => pushLog(`=== ${message} ===`),
    info: (message) => pushLog(`[info] ${message}`),
    success: (message) => pushLog(`[done] ${message}`),
    warn: (message) => pushLog(`[warn] ${message}`),
    error: (message) => pushLog(`[error] ${message}`),
    dim: (message) => pushLog(`      ${message}`),
  };
}

function pushLog(message: string): void {
  state.logs = [...state.logs, message].slice(-80);
  cel.render();
}

function formatActionTitle(action: "validate" | "build" | "install"): string {
  if (action === "validate") return "Validate";
  if (action === "build") return "Build";
  return "Install";
}

function exitApp(code: number): void {
  cel.stop();
  process.exit(code);
}

export const __test = {
  getState(): TuiState {
    return state;
  },
  resetState(): void {
    Object.assign(state, createInitialState());
  },
  handleEffect,
};

/**
 * Start the interactive ULIS terminal UI.
 */
export function runTui(): void {
  main();
}

if (import.meta.main) {
  main();
}
