import { PLATFORM_DESCRIPTIONS, PLATFORM_LABELS, PLATFORMS, type Platform } from "../platforms.js";
import { redactUserinfo, sanitizeConsentText } from "../utils/redact.js";
import {
  assertNeverPlanItemId,
  FLOW_ITEMS,
  formatDestinationMode,
  formatFlow,
  formatPresetSourceMode,
  formatPresets,
  formatSourceMode,
  isEditedPlan,
  planItems,
  planSource,
  presetSelectionKey,
  PRESET_INSTALL_REVIEW_BACK_ROW,
  PRESET_INSTALL_REVIEW_START_ROW,
  showsPresetSourcePicker,
  visiblePresetChoices,
  type PlanItem,
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
  | {
      readonly kind: "text";
      readonly text: string;
      readonly tone?: Tone;
      readonly indent?: number;
      readonly consent?: "warning" | "command";
    }
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

export function displayWidth(value: string): number {
  return Bun.stringWidth(value);
}
/** At or above this width the plan screen splits into two side-by-side panes. */
export const SPLIT_COLUMNS = 96;

const SPINNER_FRAMES = ["|", "/", "-", "\\"] as const;
const MAX_VISIBLE_LOGS = 40;

const NAV_CONTROLS = ["j/k or arrows: move", "Enter: select", "Backspace: back", "q: quit"];
const REVIEW_CONTROLS = ["PgDn: review commands", "Enter: select", "Bksp: back", "q: quit"];
const REVIEW_MOUSE_CONTROL = "wheel: review";
const TOGGLE_CONTROLS = ["j/k or arrows: move", "Enter/x/space: toggle", "Backspace: back", "q: quit"];
const MOUSE_CONTROL = "mouse: click rows, wheel scrolls";

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

function planView(state: TuiState, cwd?: string, userHome?: string): ScreenView {
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

function sourceView(state: TuiState): ScreenView {
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

function customSourceView(state: TuiState): ScreenView {
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

function customPresetSourceView(state: TuiState): ScreenView {
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

function presetsView(state: TuiState): ScreenView {
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

function missingSourceView(state: TuiState, cwd?: string, userHome?: string): ScreenView {
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

/**
 * The trust boundary for TUI-initiated remote installs: every entry here is code from a repository
 * the user did not write. The planner decides what qualifies and adds classes over time - some
 * entries run during the install, others are files a host agent executes on its own afterwards -
 * so the framing stays deliberately general rather than naming the classes it happens to list
 * today. Text is pre-sanitised by the planner, so a hostile manifest cannot forge or hide a line.
 * Renders nothing when the install is purely local.
 *
 * An empty list is not "nothing happens": it means nothing this planner recognises as executable,
 * while the remote tree's agents, skills, rules and instructions still land in the destination.
 * `confirmRemoteCommands` in `install/trust-gate.ts` refuses to skip its gate there for exactly that reason,
 * so this screen keeps its own gate - in the CLI's own words, so both surfaces say one thing.
 */
function remoteCommandRows(state: TuiState): ViewRow[] {
  if (!isRemoteReview(state)) return [];
  if (state.remoteCommands.length === 0) {
    return [
      {
        kind: "text",
        text: "Nothing here was recognised as executable - which is not a guarantee.",
        tone: "warn",
      },
      {
        kind: "text",
        text: `  Its files will still be installed for: ${formatPlatforms(state.platforms)}.`,
        tone: "muted",
        // A consent row even though it lists no command: it is the only thing on this screen that
        // has to be read before an empty-plan remote install may start.
        consent: "command",
      },
    ];
  }
  return [
    {
      kind: "text",
      text: "The remote entries below run during install, run later inside your agent, or widen what it may run without asking.",
      tone: "warn",
    },
    ...state.remoteCommands.map(
      (command): ViewRow => ({
        kind: "text",
        text: `  ${sanitizeConsentText(command)}`,
        tone: "muted",
        consent: "command",
      }),
    ),
  ];
}

function remoteWarningRows(state: TuiState, columns: number): ViewRow[] {
  if (!isRemoteReview(state)) return [];
  const source = formatRemoteSource(sanitizeConsentText(state.remoteCommandSource), columns);
  const count = state.remoteCommands.length;
  return [
    {
      kind: "text",
      // With nothing recognised there is no count to state, but the install is no less remote:
      // the banner drops to what remains true rather than disappearing.
      text:
        count === 0
          ? "REMOTE: source files WILL be installed"
          : `REMOTE: ${count} ${count === 1 ? "entry" : "entries"} WILL apply`,
      tone: "error",
      consent: "warning",
    },
    { kind: "text", text: `@ ${source}`, tone: "error", consent: "warning" },
  ];
}

/**
 * Whether this review is installing something the user did not write. Keyed on the source rather
 * than on the command list, because an empty list is a plan the enumeration did not recognise, not
 * a local install.
 */
function isRemoteReview(state: TuiState): boolean {
  return state.remoteCommandSource !== "" || state.remoteCommands.length > 0;
}

function formatRemoteSource(value: string, columns: number): string {
  const protocol = /^[a-z][a-z0-9+.-]*:\/\//iu.exec(value)?.[0];
  const source = protocol
    ? value.slice(protocol.length).replace(/^[^/@]+@/u, "")
    : value.replace(/^(?:[^@/:]+@)?([^/:]+):/u, "$1/");
  const slash = source.indexOf("/");
  const sourceColumns = Math.max(1, columns - 7);
  if (slash < 0) return middleElide(source, sourceColumns);
  if (displayWidth(source) <= sourceColumns) return source;
  const host = source.slice(0, slash);
  const path = source.slice(slash);
  const hostWidth = displayWidth(host);
  if (hostWidth >= sourceColumns) return middleElide(host, sourceColumns);
  return `${host}${middleElide(path, sourceColumns - hostWidth)}`;
}

function middleElide(value: string, columns: number): string {
  if (displayWidth(value) <= columns) return value;
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map(
    ({ segment }) => segment,
  );
  const kept = columns - 1;
  return `${takeColumns(graphemes, Math.ceil(kept / 2))}…${takeColumns(graphemes, Math.floor(kept / 2), true)}`;
}

function takeColumns(characters: string[], columns: number, fromEnd = false): string {
  const kept: string[] = [];
  let width = 0;
  for (
    let index = fromEnd ? characters.length - 1 : 0;
    index >= 0 && index < characters.length;
    index += fromEnd ? -1 : 1
  ) {
    const character = characters[index]!;
    const nextWidth = displayWidth(character);
    if (width + nextWidth > columns) break;
    kept.push(character);
    width += nextWidth;
  }
  return fromEnd ? kept.reverse().join("") : kept.join("");
}

function installReviewView(state: TuiState, cwd?: string, userHome?: string, columns = MIN_COLUMNS): ScreenView {
  const plan = planSource(state, cwd, userHome);
  const reviewRows: ViewRow[] = [
    field("Source", sanitizeConsentText(plan.sourceDir)),
    field("Destination", plan.destBase),
    field("Platforms", formatPlatforms(state.platforms)),
    field("Presets", sanitizeConsentText(formatPresets(state))),
    { kind: "blank" },
    { kind: "text", text: formatInstallCommand(state, cwd, userHome), tone: "muted" },
    { kind: "blank" },
    ...remoteCommandRows(state),
  ];
  const actionRows: ViewRow[] = [
    ...remoteWarningRows(state, columns),
    option(state, 0, "Start install"),
    option(state, 1, "Back to plan"),
  ];

  return {
    title: "Review install",
    subtitle: "Confirm install settings before anything is written.",
    breadcrumbs: ["Start", formatFlow(state.flow), "Plan", "Review install"],
    panes: [pane("review", "Install plan", reviewRows), pane("review-actions", "Actions", actionRows, 0)],
    notice: notice(state, "Nothing is written until you start the install."),
    controls: [...REVIEW_CONTROLS, REVIEW_MOUSE_CONTROL],
  };
}

function presetInstallReviewView(state: TuiState, cwd?: string, userHome?: string, columns = MIN_COLUMNS): ScreenView {
  const plan = planSource(state, cwd, userHome);
  const reviewRows: ViewRow[] = [
    field(
      "Preset location",
      sanitizeConsentText(formatPresetSourceMode(state.presetSourceMode, state.customPresetSource)),
    ),
    field("Destination", plan.destBase),
    field("Platforms", formatPlatforms(state.platforms)),
    field("Presets", sanitizeConsentText(formatPresets(state))),
    { kind: "blank" },
    { kind: "text", text: "Action: install the selected preset directories resolved by the TUI.", tone: "muted" },
    { kind: "blank" },
    ...remoteCommandRows(state),
  ];
  const actionRows: ViewRow[] = [
    option(state, 0, "Backup existing configs before install", { checked: state.backup }),
    option(state, 1, "Prune removed agents and skills", { checked: state.prune }),
    option(state, 2, "Run preset extensions", { checked: state.presetInstallExtensions }),
    ...(state.presetSourceMode === "custom" && state.presetInstallExtensions
      ? [
          {
            kind: "text" as const,
            text: "Warning: extensions.yaml in this custom directory may run npx or bunx commands.",
            tone: "warn" as const,
          },
        ]
      : []),
    { kind: "blank" },
    ...remoteWarningRows(state, columns),
    option(state, PRESET_INSTALL_REVIEW_START_ROW, "Start preset install"),
    option(state, PRESET_INSTALL_REVIEW_BACK_ROW, "Back to presets"),
  ];

  return {
    title: "Review preset install",
    subtitle: "Confirm preset install settings before anything is written.",
    breadcrumbs: ["Start", formatFlow(state.flow), "Plan", "Review preset install"],
    panes: [pane("review", "Preset install plan", reviewRows), pane("review-actions", "Actions", actionRows, 0)],
    notice: notice(state, "Preset install ignores the current source."),
    controls: [...REVIEW_CONTROLS, "x/space: toggle", REVIEW_MOUSE_CONTROL],
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

function formatInstallCommand(state: TuiState, cwd?: string, userHome?: string): string {
  const plan = planSource(state, cwd, userHome);
  // Redacted, so a copied command may need its credentials re-added - better than showing them.
  const args = [
    "ulis",
    "install",
    "--source",
    sanitizeConsentText(plan.sourceDir),
    "--target",
    state.platforms.join(","),
    "--yes",
  ];
  if (state.destinationMode === "global") args.push("--global");
  if (state.selectedPresetNames.length > 0)
    args.push("--preset", sanitizeConsentText(state.selectedPresetNames.join(",")));
  if (!state.rebuild) args.push("--skip-rebuild");
  if (state.backup) args.push("--backup");
  if (!state.prune) args.push("--no-prune");
  if (state.skipExternalSkills) args.push("--skip-external-skills");
  return `Command: ${args.map(quoteCommandArg).join(" ")}`;
}

function quoteCommandArg(value: string): string {
  return /\s/u.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}
