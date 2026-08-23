/**
 * The multi-select/toggle picker screens - `presetsView` (checkbox list of presets, plus its
 * `presetSourceHeading` grouping labels) and `platformsView` (checkbox list of platforms) - and
 * `missingSourceView`, the recovery screen shown when the plan's chosen source doesn't exist.
 * Grouping rule: this file owns "choose zero or more of these" and "the source picked one screen
 * over doesn't exist" screens. The plan's single-choice source-path screens
 * (`sourceView`/`customSourceView`/`customPresetSourceView`) are in `./screens-plan.ts` instead -
 * check there if a screen you expected here isn't. Depends on `./types.js` and `./primitives.js`
 * only; does not import `./screens-plan.ts` or `./screens-review.ts`.
 */
import { PLATFORM_DESCRIPTIONS, PLATFORM_LABELS, PLATFORMS } from "../../platforms.js";
import { redactUserinfo } from "../../utils/redact.js";
import {
  formatFlow,
  formatPresetSourceMode,
  formatSourceMode,
  planSource,
  presetSelectionKey,
  showsPresetSourcePicker,
  visiblePresetChoices,
} from "../selectors.js";
import type { TuiState } from "../state-model.js";
import { formatPlatforms, notice, option, pane } from "./primitives.js";
import { MOUSE_CONTROL, NAV_CONTROLS, TOGGLE_CONTROLS, type ScreenView, type ViewRow } from "./types.js";

export function presetsView(state: TuiState): ScreenView {
  const rows: ViewRow[] = [];
  const sourceRows = showsPresetSourcePicker(state) ? 1 : 0;

  if (sourceRows === 1) {
    rows.push(
      option(state, 0, "Preset location", {
        value: formatPresetSourceMode(state.presetSourceMode, state.customPresetSource),
        description:
          state.presetSourceMode === "custom"
            ? "Press Enter to edit the directory, or Space to return to automatic locations."
            : "Press Space to cycle locations, or Enter to choose a custom directory.",
      }),
      { kind: "blank" },
    );
  }

  const presets = visiblePresetChoices(state);
  if (presets.length === 0) {
    rows.push({ kind: "text", text: "No presets found in the selected location.", tone: "warn" });
  } else {
    let previousSource: string | undefined;
    presets.forEach((preset, index) => {
      if (preset.source !== previousSource) {
        previousSource = preset.source;
        rows.push({ kind: "heading", text: presetSourceHeading(preset.source) });
      }
      rows.push(
        option(state, index + sourceRows, `${preset.name} (${preset.source})`, {
          checked: state.selectedPresetNames.includes(presetSelectionKey(state, preset)),
          description: preset.description,
        }),
      );
    });
  }

  const continueIndex = presets.length + sourceRows;
  const backIndex = state.flow === "presetsOnly" ? continueIndex + 1 : continueIndex;
  rows.push({ kind: "blank" });
  rows.push(option(state, continueIndex, state.flow === "presetsOnly" ? "Continue to plan" : "Back to plan"));
  if (state.flow === "presetsOnly") rows.push(option(state, backIndex, "Back to start"));

  return {
    title: state.flow === "presetsOnly" ? "Select preset sources" : "Select preset layers",
    subtitle:
      state.flow === "presetsOnly"
        ? "Choose presets to install without reading a base source."
        : "Choose optional presets to merge before the base source.",
    breadcrumbs: ["Start", formatFlow(state.flow), "Presets"],
    panes: [pane("presets", "Presets", rows)],
    notice: notice(
      state,
      state.flow === "presetsOnly"
        ? "Selected presets are the whole input. No base source will be read."
        : "Selected presets are applied before the base source for Validate, Build, and Install.",
    ),
    controls: [...TOGGLE_CONTROLS, MOUSE_CONTROL],
  };
}

function presetSourceHeading(source: string): string {
  if (source === "project") return "Project presets";
  if (source === "global" || source === "user") return "Global presets";
  if (source === "bundled") return "Bundled presets";
  return "Custom presets";
}

export function platformsView(state: TuiState): ScreenView {
  const rows: ViewRow[] = [
    option(state, 0, "All platforms", {
      checked: state.platforms.length === PLATFORMS.length,
      description: "Select every supported platform in one action.",
    }),
  ];

  PLATFORMS.forEach((platform, index) => {
    rows.push(
      option(state, index + 1, PLATFORM_LABELS[platform], {
        checked: state.platforms.includes(platform),
        description: PLATFORM_DESCRIPTIONS[platform],
      }),
    );
  });

  rows.push({ kind: "blank" }, option(state, PLATFORMS.length + 1, "Back to plan"));

  return {
    title: "Select platforms",
    subtitle: "Choose which platform configs the plan should operate on.",
    breadcrumbs: ["Start", formatFlow(state.flow), "Plan", "Platforms"],
    panes: [pane("platforms", `Selected: ${formatPlatforms(state.platforms)}`, rows)],
    notice: notice(state, "At least one platform must stay selected before running an action."),
    controls: [...TOGGLE_CONTROLS, MOUSE_CONTROL],
  };
}

export function missingSourceView(state: TuiState, cwd?: string, userHome?: string): ScreenView {
  const plan = planSource(state, cwd, userHome);
  const rows: ViewRow[] = [
    { kind: "text", text: `Missing source: ${redactUserinfo(plan.sourceDir)}`, tone: "error" },
    { kind: "blank" },
  ];

  if (state.sourceMode === "custom") {
    rows.push({
      kind: "text",
      text: "Custom sources cannot be initialized automatically because their project name and owner are unknown.",
      tone: "muted",
    });
    rows.push({ kind: "blank" });
    rows.push(option(state, 0, "Choose a different source"), option(state, 1, "Back to plan"));
  } else {
    rows.push(
      option(state, 0, `Initialize ${formatSourceMode(state.sourceMode)}`),
      option(state, 1, "Choose a different source"),
      option(state, 2, "Back to plan"),
    );
  }

  return {
    title: "Source not found",
    subtitle: "The selected action needs a source tree before it can continue.",
    breadcrumbs: ["Start", formatFlow(state.flow), "Source not found"],
    panes: [pane("missing", "Options", rows)],
    notice: notice(state, "Initializing scaffolds a fresh .ulis tree, then resumes the pending action."),
    controls: [...NAV_CONTROLS, MOUSE_CONTROL],
  };
}
