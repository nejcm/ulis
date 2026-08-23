/**
 * The running/result screens: `runningView` (shown while a workflow executes) and `resultView`
 * (shown once it finishes), plus the shared `logRows` that both feed from `state.logs`. Neither
 * screen is reachable from `buildScreenView`'s other branches, so this stays its own module rather
 * than folding into `screens-review.ts` or the plan/select groups next to it.
 */
import { formatFlow } from "../selectors.js";
import type { TuiState } from "../state-model.js";
import { pane, splitLogTag } from "./primitives.js";
import { MOUSE_CONTROL, type ScreenView, type ViewRow } from "./types.js";

const SPINNER_FRAMES = ["|", "/", "-", "\\"] as const;
const MAX_VISIBLE_LOGS = 40;

export function runningView(state: TuiState): ScreenView {
  const spinner = SPINNER_FRAMES[state.runningSpinnerFrame % SPINNER_FRAMES.length] ?? "|";
  return {
    title: `Running ${spinner}`,
    subtitle: "The selected workflow is in progress.",
    breadcrumbs: ["Start", formatFlow(state.flow), "Running"],
    panes: [pane("logs", "Log output", logRows(state))],
    notice: { text: "Press q to stop the current workflow.", tone: "warn" },
    controls: ["q: stop", MOUSE_CONTROL],
  };
}

export function resultView(state: TuiState): ScreenView {
  return {
    title: state.resultTitle || "Result",
    subtitle: state.resultMessage,
    breadcrumbs: ["Start", formatFlow(state.flow), "Result"],
    panes: [pane("logs", "Recent log output", logRows(state))],
    notice: { text: "Press Enter to return to the plan, or q to quit.", tone: "accent" },
    controls: ["Enter: back to plan", "q: quit", MOUSE_CONTROL],
  };
}

function logRows(state: TuiState): ViewRow[] {
  const recent = state.logs.slice(-MAX_VISIBLE_LOGS);
  if (recent.length === 0) return [{ kind: "text", text: "Waiting for log output...", tone: "muted" }];
  return recent.map((entry) => {
    const { text, tag } = splitLogTag(entry);
    return { kind: "log", text, tag } satisfies ViewRow;
  });
}
