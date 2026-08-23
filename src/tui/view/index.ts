/**
 * Public face of `tui/view/`: `buildScreenView` dispatches `state.screen` to the screen-group
 * modules (`screens-plan.ts`, `screens-select.ts`, `screens-review.ts`, `screens-run.ts`) and this
 * file re-exports exactly the runtime surface the rest of the TUI consumes -
 * `MIN_COLUMNS`/`MIN_ROWS`/`SPLIT_COLUMNS`, `displayWidth`, `splitLogTag`, plus the `ScreenView`
 * family of types. It holds no screen logic of its own; that all lives one level down.
 */
import type { TuiState } from "../state-model.js";
import { customPresetSourceView, customSourceView, flowView, planView, sourceView } from "./screens-plan.js";
import { installReviewView, presetInstallReviewView } from "./screens-review.js";
import { runningView, resultView } from "./screens-run.js";
import { missingSourceView, platformsView, presetsView } from "./screens-select.js";
import { MIN_COLUMNS, type ScreenView } from "./types.js";

export type { ScreenView, Tone, ViewInput, ViewPane, ViewRow, ViewTag } from "./types.js";
export { MIN_COLUMNS, MIN_ROWS, SPLIT_COLUMNS } from "./types.js";
export { displayWidth, splitLogTag } from "./primitives.js";

export function buildScreenView(state: TuiState, cwd?: string, userHome?: string, columns = MIN_COLUMNS): ScreenView {
  switch (state.screen) {
    case "flow":
      return flowView(state);
    case "plan":
      return planView(state, cwd, userHome);
    case "source":
      return sourceView(state);
    case "customSource":
      return customSourceView(state);
    case "customPresetSource":
      return customPresetSourceView(state);
    case "presets":
      return presetsView(state);
    case "platforms":
      return platformsView(state);
    case "missingSource":
      return missingSourceView(state, cwd, userHome);
    case "installReview":
      return installReviewView(state, cwd, userHome, columns);
    case "presetInstallReview":
      return presetInstallReviewView(state, cwd, userHome, columns);
    case "running":
      return runningView(state);
    case "result":
      return resultView(state);
  }
}
