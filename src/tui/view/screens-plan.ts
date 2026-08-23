/**
 * The flow-start screen, the plan screen, and the three source-path screens that hang off the
 * plan's "Base source" field: `sourceView` (pick project/global/custom), `customSourceView` and
 * `customPresetSourceView` (type a path). Grouping rule: this file owns the screens that lead the
 * user toward *which* source to read. Multi-select/toggle picker screens (presets, platforms) and
 * the missing-source recovery screen are in `./screens-select.ts` instead - check there if a
 * screen you expected here isn't. Depends on `./types.js` and `./primitives.js` only; does not
 * import `./screens-select.ts` or `./screens-review.ts`.
 */
import { redactUserinfo } from "../../utils/redact.js";
import {
  formatDestinationMode,
  formatFlow,
  formatPresetSourceMode,
  formatPresets,
  formatSourceMode,
  isEditedPlan,
  planItems,
  planSource,
  showsPresetSourcePicker,
  visiblePresetChoices,
} from "../selectors.js";
import { assertNeverPlanItemId, FLOW_ITEMS, type PlanItem, type TuiState } from "../state-model.js";
import { field, formatPlatforms, notice, onOff, option, pane } from "./primitives.js";
import { MOUSE_CONTROL, NAV_CONTROLS, type ScreenView, type ViewRow } from "./types.js";

export function flowView(state: TuiState): ScreenView {
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

export function planView(state: TuiState, cwd?: string, userHome?: string): ScreenView {
  const plan = planSource(state, cwd, userHome);
  const presetLabel = state.flow === "presetsOnly" ? "Preset sources" : "Preset layers";

  const overview: ViewRow[] = [{ kind: "heading", text: "Input" }];
  if (showsPresetSourcePicker(state)) {
    overview.push(
      field(`${presetLabel} location`, formatPresetSourceMode(state.presetSourceMode, state.customPresetSource)),
    );
  }
  overview.push(field(presetLabel, formatPresets(state)));
  overview.push(
    state.flow === "presetsOnly"
      ? field("Base source", "none (preset-only install)")
      : field(
          "Base source",
          `${formatSourceMode(state.sourceMode, state.customSource)} -> ${redactUserinfo(plan.sourceDir)}`,
        ),
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

  const actions: ViewRow[] = planItems(state).flatMap((item, index) => {
    const value = planItemValue(state, item);
    // Not a truthiness test: `value` is `string | undefined`, and an empty string is a value the
    // row should still show, not treat as absent.
    const row = option(state, index, item.label, value !== undefined ? { value } : {});
    return item.breakAfter ? [row, { kind: "blank" } as ViewRow] : [row];
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

function planItemValue(state: TuiState, item: PlanItem): string | undefined {
  switch (item.id) {
    case "source":
      return formatSourceMode(state.sourceMode, state.customSource);
    case "destination":
      return formatDestinationMode(state.destinationMode);
    case "presets":
      return `${selectedPresetCount(state)} selected`;
    case "platforms":
      return `${state.platforms.length} selected`;
    case "backup":
      return onOff(state.backup);
    case "prune":
      return onOff(state.prune);
    case "rebuild":
      return onOff(state.rebuild);
    case "presetExtensions":
      return onOff(state.presetInstallExtensions);
    case "skipExternalSkills":
      return onOff(state.skipExternalSkills);
    case "validate":
    case "build":
    case "install":
    case "back":
      return undefined;
    default:
      return assertNeverPlanItemId(item.id);
  }
}

function selectedPresetCount(state: TuiState): number {
  const visible = visiblePresetChoices(state);
  return state.selectedPresetNames.filter((name) => visible.some((preset) => preset.name === name)).length;
}

export function sourceView(state: TuiState): ScreenView {
  const rows: ViewRow[] = [
    option(state, 0, "Project", { value: ".ulis/ (repository-local config)" }),
    option(state, 1, "Global", { value: "~/.ulis/ (home tool configs)" }),
    option(state, 2, "Custom", { value: redactUserinfo(state.customSource) || "Set a custom path" }),
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

export function customSourceView(state: TuiState): ScreenView {
  const rows: ViewRow[] = [];
  if (state.recentCustomSources.length > 0) {
    // Recents are written redacted, but older persisted entries may not be - redact on render too.
    state.recentCustomSources.forEach((source, index) => {
      rows.push(option(state, index + 1, redactUserinfo(source)));
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
      // NOT redacted: app.ts writes this back into the live field, so redacting here would strip
      // the credentials out of the value before the clone ever sees them.
      value: state.textInput,
      placeholder: "Path to .ulis or its parent directory",
      focused: state.cursor === 0,
    },
    notice: notice(state, "Enter saves. Up/Down moves to recents when present. Escape cancels."),
    controls: ["Enter: save", "Esc: cancel", "Ctrl+V: paste", "arrows: recents", MOUSE_CONTROL],
  };
}

export function customPresetSourceView(state: TuiState): ScreenView {
  return {
    title: "Custom preset directory",
    subtitle: "Type a directory containing preset folders, then press Enter.",
    breadcrumbs: ["Start", "Install presets only", "Presets", "Custom directory"],
    panes: [],
    input: {
      value: state.textInput,
      placeholder: "Path to a presets directory",
      focused: true,
    },
    notice: notice(state, "Enter scans the directory. Escape cancels."),
    controls: ["Enter: scan", "Esc: cancel", "Ctrl+V: paste"],
  };
}
