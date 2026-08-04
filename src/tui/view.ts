import { PLATFORM_DESCRIPTIONS, PLATFORM_LABELS, PLATFORMS, type Platform } from "../platforms.js";
import {
  FLOW_ITEMS,
  formatDestinationMode,
  formatFlow,
  formatPresetSourceMode,
  formatPresets,
  formatSourceMode,
  isEditedPlan,
  planItems,
  planItemsBreaks,
  planSource,
  presetSelectionKey,
  showsPresetSourcePicker,
  visiblePresetChoices,
  type TuiPlanItem,
  type TuiState,
} from "./state.js";

/** Semantic color slots resolved to concrete colors by the theme. */
export type Tone = "default" | "muted" | "accent" | "success" | "warn" | "error";

export interface ViewTag {
  readonly text: string;
  readonly tone: Tone;
}

export type ViewRow =
  | { readonly kind: "blank" }
  | { readonly kind: "heading"; readonly text: string }
  | { readonly kind: "text"; readonly text: string; readonly tone?: Tone; readonly indent?: number }
  | { readonly kind: "field"; readonly label: string; readonly value: string }
  | {
      readonly kind: "option";
      /** Cursor index this row maps to; used by keyboard focus and click routing. */
      readonly index: number;
      readonly selected: boolean;
      readonly label: string;
      readonly value?: string;
      readonly description?: string;
      readonly checked?: boolean;
    }
  | { readonly kind: "log"; readonly text: string; readonly tag?: ViewTag };

export interface ViewPane {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly ViewRow[];
  readonly grow: number;
}

export interface ViewInput {
  readonly value: string;
  readonly placeholder: string;
  readonly focused: boolean;
}

export interface ScreenView {
  readonly title: string;
  readonly subtitle: string;
  readonly breadcrumbs: readonly string[];
  readonly panes: readonly ViewPane[];
  readonly input?: ViewInput;
  readonly notice: { readonly text: string; readonly tone: Tone };
  readonly controls: readonly string[];
}

/** Terminal must be at least this large before the app renders its shell. */
export const MIN_COLUMNS = 50;
export const MIN_ROWS = 16;
/** At or above this width the plan screen splits into two side-by-side panes. */
export const SPLIT_COLUMNS = 96;

const SPINNER_FRAMES = ["|", "/", "-", "\\"] as const;
const MAX_VISIBLE_LOGS = 40;

const NAV_CONTROLS = ["j/k or arrows: move", "Enter: select", "Backspace: back", "q: quit"];
const TOGGLE_CONTROLS = ["j/k or arrows: move", "Enter/x/space: toggle", "Backspace: back", "q: quit"];
const MOUSE_CONTROL = "mouse: click rows, wheel scrolls";

export function buildScreenView(state: TuiState, cwd?: string): ScreenView {
  switch (state.screen) {
    case "flow":
      return flowView(state);
    case "plan":
      return planView(state, cwd);
    case "source":
      return sourceView(state);
    case "customSource":
      return customSourceView(state);
    case "presets":
      return presetsView(state);
    case "platforms":
      return platformsView(state);
    case "missingSource":
      return missingSourceView(state, cwd);
    case "installReview":
      return installReviewView(state, cwd);
    case "presetInstallReview":
      return presetInstallReviewView(state, cwd);
    case "running":
      return runningView(state);
    case "result":
      return resultView(state);
  }
}

function flowView(state: TuiState): ScreenView {
  const descriptions: Record<(typeof FLOW_ITEMS)[number], string> = {
    "Update this project": "Read ./.ulis and write tool configs in this repo.",
    "Update global configs": "Read ~/.ulis and write home-level tool configs.",
    "Use custom source": "Choose a ULIS source path, then pick where to install.",
    "Install presets only": "Install selected presets without reading a base source.",
    Quit: "Exit the TUI.",
  };

  const rows: ViewRow[] = FLOW_ITEMS.map((label, index) =>
    option(state, index, label, { description: descriptions[label] }),
  );

  return {
    title: "ULIS",
    subtitle: "Define AI configs once, then generate native configs for each tool.",
    breadcrumbs: ["Start"],
    panes: [pane("workflow", "What do you want to update?", rows)],
    notice: notice(state, "Pick a workflow. You can edit the plan before running anything."),
    controls: [...NAV_CONTROLS, MOUSE_CONTROL],
  };
}

function planView(state: TuiState, cwd?: string): ScreenView {
  const plan = planSource(state, cwd);
  const presetLabel = state.flow === "presetsOnly" ? "Preset sources" : "Preset layers";

  const overview: ViewRow[] = [{ kind: "heading", text: "Input" }];
  if (showsPresetSourcePicker(state)) {
    overview.push(field(`${presetLabel} location`, formatPresetSourceMode(state.presetSourceMode)));
  }
  overview.push(field(presetLabel, formatPresets(state)));
  overview.push(
    state.flow === "presetsOnly"
      ? field("Base source", "none (preset-only install)")
      : field("Base source", `${formatSourceMode(state.sourceMode, state.customSource)} -> ${plan.sourceDir}`),
    { kind: "blank" },
    { kind: "heading", text: "Output" },
    field("Platforms", formatPlatforms(state.platforms)),
    field("Install destination", `${formatDestinationMode(state.destinationMode)} -> ${plan.destBase}`),
    { kind: "blank" },
    { kind: "heading", text: "Install options" },
    field("Backup", onOff(state.backup)),
    field("Prune removed agents and skills", onOff(state.prune)),
    field("Use latest build output", onOff(state.rebuild)),
    field("Skip external skills", onOff(state.skipExternalSkills)),
  );

  const items = planItems(state);
  const breaks = planItemsBreaks(state);
  const actions: ViewRow[] = items.flatMap((label, index) => {
    const value = planItemValue(state, label);
    const row = option(state, index, label, value === label ? {} : { value });
    return breaks.includes(index) ? [row, { kind: "blank" } as ViewRow] : [row];
  });

  return {
    title: isEditedPlan(state) ? "Edited plan" : formatFlow(state.flow),
    subtitle: "Review and adjust the plan before choosing an action.",
    breadcrumbs: ["Start", formatFlow(state.flow), "Plan"],
    panes: [pane("overview", "Summary", overview, 1), pane("actions", "Actions", actions, 1)],
    notice: notice(state, "Tip: validate checks the source and presets without writing generated files."),
    controls: [...NAV_CONTROLS, MOUSE_CONTROL],
  };
}

function planItemValue(state: TuiState, label: TuiPlanItem): string {
  if (label === "Base source") return formatSourceMode(state.sourceMode, state.customSource);
  if (label === "Install destination") return formatDestinationMode(state.destinationMode);
  if (label === "Preset layers" || label === "Preset sources") return `${selectedPresetCount(state)} selected`;
  if (label === "Platforms") return `${state.platforms.length} selected`;
  if (label === "Backup") return onOff(state.backup);
  if (label === "Prune removed agents and skills") return onOff(state.prune);
  if (label === "Use latest build output") return onOff(state.rebuild);
  if (label === "Run preset extensions") return onOff(state.presetInstallExtensions);
  if (label === "Skip external skills") return onOff(state.skipExternalSkills);
  return label;
}

function sourceView(state: TuiState): ScreenView {
  const rows: ViewRow[] = [
    option(state, 0, "Project", { value: ".ulis/ (repository-local config)" }),
    option(state, 1, "Global", { value: "~/.ulis/ (home tool configs)" }),
    option(state, 2, "Custom", { value: state.customSource || "Set a custom path" }),
    option(state, 3, "Back to plan"),
  ];

  return {
    title: "Select source",
    subtitle: "Choose which ULIS source tree the plan should read.",
    breadcrumbs: ["Start", formatFlow(state.flow), "Plan", "Source"],
    panes: [pane("source", "Sources", rows)],
    notice: notice(
      state,
      "Project and global choices also update the default install destination. You can still edit it on the plan.",
    ),
    controls: [...NAV_CONTROLS, MOUSE_CONTROL],
  };
}

function customSourceView(state: TuiState): ScreenView {
  const rows: ViewRow[] = [];
  if (state.recentCustomSources.length > 0) {
    state.recentCustomSources.forEach((source, index) => {
      rows.push(option(state, index + 1, source));
    });
  } else {
    rows.push({ kind: "text", text: "No recent custom sources yet.", tone: "muted" });
  }

  return {
    title: "Custom source path",
    subtitle: "Type a source directory path, then press Enter.",
    breadcrumbs: ["Start", "Custom source", "Path"],
    panes: [pane("recent", "Recent", rows)],
    input: {
      value: state.textInput,
      placeholder: "Path to .ulis or its parent directory",
      focused: state.cursor === 0,
    },
    notice: notice(state, "Enter saves. Up/Down moves to recents when present. Escape cancels."),
    controls: ["Enter: save", "Esc: cancel", "Ctrl+V: paste", "arrows: recents", MOUSE_CONTROL],
  };
}

function presetsView(state: TuiState): ScreenView {
  const rows: ViewRow[] = [];
  const sourceRows = showsPresetSourcePicker(state) ? 1 : 0;

  if (sourceRows === 1) {
    rows.push(
      option(state, 0, "Preset location", {
        value: formatPresetSourceMode(state.presetSourceMode),
        description: "Press Enter or Space to cycle where preset folders are searched.",
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
  return "Bundled presets";
}

function platformsView(state: TuiState): ScreenView {
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

function missingSourceView(state: TuiState, cwd?: string): ScreenView {
  const plan = planSource(state, cwd);
  const rows: ViewRow[] = [
    { kind: "text", text: `Missing source: ${plan.sourceDir}`, tone: "error" },
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

function installReviewView(state: TuiState, cwd?: string): ScreenView {
  const plan = planSource(state, cwd);
  const rows: ViewRow[] = [
    field("Source", plan.sourceDir),
    field("Destination", plan.destBase),
    field("Platforms", formatPlatforms(state.platforms)),
    field("Presets", formatPresets(state)),
    { kind: "blank" },
    { kind: "text", text: formatInstallCommand(state, cwd), tone: "muted" },
    { kind: "blank" },
    option(state, 0, "Start install"),
    option(state, 1, "Back to plan"),
  ];

  return {
    title: "Review install",
    subtitle: "Confirm install settings before anything is written.",
    breadcrumbs: ["Start", formatFlow(state.flow), "Plan", "Review install"],
    panes: [pane("review", "Install plan", rows)],
    notice: notice(state, "Nothing is written until you start the install."),
    controls: [...NAV_CONTROLS, MOUSE_CONTROL],
  };
}

function presetInstallReviewView(state: TuiState, cwd?: string): ScreenView {
  const plan = planSource(state, cwd);
  const rows: ViewRow[] = [
    field("Preset location", formatPresetSourceMode(state.presetSourceMode)),
    field("Destination", plan.destBase),
    field("Platforms", formatPlatforms(state.platforms)),
    field("Presets", formatPresets(state)),
    { kind: "blank" },
    { kind: "text", text: "Action: install the selected preset directories resolved by the TUI.", tone: "muted" },
    { kind: "blank" },
    option(state, 0, "Backup existing configs before install", { checked: state.backup }),
    option(state, 1, "Prune removed agents and skills", { checked: state.prune }),
    option(state, 2, "Run preset extensions", { checked: state.presetInstallExtensions }),
    { kind: "blank" },
    option(state, 3, "Start preset install"),
    option(state, 4, "Back to presets"),
  ];

  return {
    title: "Review preset install",
    subtitle: "Confirm preset install settings before anything is written.",
    breadcrumbs: ["Start", formatFlow(state.flow), "Plan", "Review preset install"],
    panes: [pane("review", "Preset install plan", rows)],
    notice: notice(state, "Preset install does not read or merge the current source."),
    controls: [...TOGGLE_CONTROLS, MOUSE_CONTROL],
  };
}

function runningView(state: TuiState): ScreenView {
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

function resultView(state: TuiState): ScreenView {
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

export function splitLogTag(entry: string): { readonly text: string; readonly tag?: ViewTag } {
  const match = entry.match(/^\[(info|done|warn|error)\]\s*([\s\S]*)$/u);
  if (!match) return { text: entry };

  const [, level, text] = match;
  const tone = { info: "accent", done: "success", warn: "warn", error: "error" }[level as string] as Tone;
  return { text: text ?? "", tag: { text: `[${level}]`, tone } };
}

function pane(id: string, title: string, rows: readonly ViewRow[], grow = 1): ViewPane {
  return { id, title, rows, grow };
}

function field(label: string, value: string): ViewRow {
  return { kind: "field", label, value };
}

function option(
  state: TuiState,
  index: number,
  label: string,
  extras: { value?: string; description?: string; checked?: boolean } = {},
): ViewRow {
  return {
    kind: "option",
    index,
    selected: state.cursor === index,
    label,
    ...extras,
  };
}

function notice(state: TuiState, fallback: string): { readonly text: string; readonly tone: Tone } {
  return state.notice ? { text: state.notice, tone: "warn" } : { text: fallback, tone: "muted" };
}

function onOff(value: boolean): string {
  return value ? "on" : "off";
}

function selectedPresetCount(state: TuiState): number {
  const visible = visiblePresetChoices(state);
  return state.selectedPresetNames.filter((name) => visible.some((preset) => preset.name === name)).length;
}

function formatPlatforms(platforms: readonly Platform[]): string {
  return platforms.length > 0 ? platforms.map((platform) => PLATFORM_LABELS[platform]).join(", ") : "none";
}

function formatInstallCommand(state: TuiState, cwd?: string): string {
  const plan = planSource(state, cwd);
  const args = ["ulis", "install", "--source", plan.sourceDir, "--target", state.platforms.join(","), "--yes"];
  if (state.destinationMode === "global") args.push("--global");
  if (state.selectedPresetNames.length > 0) args.push("--preset", state.selectedPresetNames.join(","));
  if (!state.rebuild) args.push("--skip-rebuild");
  if (state.backup) args.push("--backup");
  if (!state.prune) args.push("--no-prune");
  if (state.skipExternalSkills) args.push("--skip-external-skills");
  return `Command: ${args.map(quoteCommandArg).join(" ")}`;
}

function quoteCommandArg(value: string): string {
  return /\s/u.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}
