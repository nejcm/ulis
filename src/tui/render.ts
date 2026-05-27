import { HStack, Text, TextInput, VStack, type Color, type Node } from "@cel-tui/core";

import { PLATFORM_DESCRIPTIONS, PLATFORM_LABELS, PLATFORMS, type Platform } from "../platforms.js";
import {
  FLOW_ITEMS,
  formatDestinationMode,
  formatFlow,
  formatPresetSourceMode,
  formatPresets,
  formatSourceMode,
  isEditedPlan,
  planSource,
  planItems,
  presetSelectionKey,
  showsPresetSourcePicker,
  visiblePresetChoices,
  type TuiState,
  type TuiPlanItem,
} from "./state.js";

interface UiLine {
  readonly text: string;
  readonly value?: string;
  readonly fgColor?: Color;
  readonly bold?: boolean;
  readonly indent?: number;
}

const CARD_MAX_WIDTH = 104;
const TITLE = [
  " _   _ _     ___ ____  ",
  "| | | | |   |_ _/ ___| ",
  "| | | | |    | |\\___ \\ ",
  "| |_| | |___ | | ___) |",
  " \\___/|_____|___|____/ ",
].join("\n");
const SUBTITLE = `ULIS - Unified LLM Interface Specification. Define AI configs once, then generate native configs for each tool.`;

export interface CustomSourceHandlers {
  readonly onCustomSourceChange: (value: string) => void;
  readonly onCustomSourceKeyPress: (key: string) => boolean | undefined;
}

export function renderScreen(state: TuiState, customSourceHandlers?: CustomSourceHandlers) {
  switch (state.screen) {
    case "flow":
      return renderFlowSelection(state);
    case "plan":
      return renderPlan(state);
    case "source":
      return renderSourceSelection(state);
    case "customSource":
      return renderCustomSource(state, customSourceHandlers);
    case "presets":
      return renderPresets(state);
    case "platforms":
      return renderPlatforms(state);
    case "missingSource":
      return renderMissingSource(state);
    case "installReview":
      return renderInstallReview(state);
    case "presetInstallReview":
      return renderPresetInstallReview(state);
    case "running":
      return renderRunning(state);
    case "result":
      return renderCard(state.resultTitle, state.resultMessage, [
        { text: "Recent log output", fgColor: "color06", bold: true },
        { text: "" },
        ...renderLogLines(state),
        { text: "" },
        {
          text: "Press Enter to return to the plan, or q to quit.",
          fgColor: "color06",
          bold: true,
        },
      ]);
  }
}

function renderRunning(state: TuiState) {
  const frames = ["|", "/", "-", "\\"];
  const spinner = frames[state.runningSpinnerFrame % frames.length] ?? "|";
  return renderCard(
    `Running ${spinner}`,
    "The selected workflow is in progress. Press q to stop.",
    renderLogLines(state),
  );
}

function renderFlowSelection(state: TuiState) {
  const rows = FLOW_ITEMS.map((label, index) => {
    const subtitles: Record<(typeof FLOW_ITEMS)[number], string> = {
      "Update this project": "Read ./.ulis and write tool configs in this repo.",
      "Update global configs": "Read ~/.ulis and write home-level tool configs.",
      "Use custom source": "Choose a ULIS source path, then pick where to install.",
      "Install presets only": "Install selected presets without reading a base source.",
      Quit: "Exit the TUI.",
    };
    return [
      selectableLine(state.cursor, index, label),
      { text: subtitles[label], indent: 4, fgColor: "color08" } satisfies UiLine,
    ];
  }).flat();

  return renderCard(TITLE, SUBTITLE, [
    { text: "What do you want to update?", fgColor: "color06", bold: true },
    { text: "" },
    ...rows,
    { text: "" },
    {
      text: state.notice || "Pick a workflow. You can edit the plan before running anything.",
      fgColor: state.notice ? "color03" : "color08",
    },
  ]);
}

function renderPlan(state: TuiState) {
  const plan = planSource(state);
  const items = planItems(state);
  const rows: UiLine[] = items.flatMap((label, index) => {
    const row = planActionLine(state, label, index);
    const shouldBreak =
      label === "Platforms" || label === "Use latest build output" || label === "Run preset extensions";
    return shouldBreak ? [row, { text: "" }] : [row];
  });
  const presetLabel = state.flow === "presetsOnly" ? "Preset sources" : "Preset layers";
  const baseSourceLine =
    state.flow === "presetsOnly"
      ? "Base source: none (preset-only install)"
      : `Base source: ${formatSourceMode(state.sourceMode, state.customSource)} -> ${plan.sourceDir}`;

  return renderCard(
    isEditedPlan(state) ? "Edited Plan" : formatFlow(state.flow),
    "Review and adjust the plan before choosing an action.",
    [
      { text: "Input", fgColor: "color06", bold: true },
      ...(showsPresetSourcePicker(state)
        ? [{ text: `${presetLabel} location: ${formatPresetSourceMode(state.presetSourceMode)}` }]
        : []),
      { text: `${presetLabel}: ${formatPresets(state)}` },
      { text: baseSourceLine },
      { text: "" },
      { text: "Output", fgColor: "color06", bold: true },
      { text: `Platforms: ${formatPlatforms(state.platforms)}` },
      { text: `Install destination: ${formatDestinationMode(state.destinationMode)} -> ${plan.destBase}` },
      { text: "" },
      { text: "Install options", fgColor: "color06", bold: true },
      { text: `Backup: ${state.backup ? "on" : "off"}` },
      { text: `Use latest build output: ${state.rebuild ? "on" : "off"}` },
      { text: "" },
      { text: "Actions", fgColor: "color06", bold: true },
      { text: "" },
      ...rows,
      { text: "" },
      {
        text: state.notice || "Tip: validate checks source and presets without writing generated files.",
        fgColor: state.notice ? "color03" : "color08",
      },
    ],
  );
}

function planLabel(state: TuiState, label: TuiPlanItem): string {
  if (label === "Base source") return formatSourceMode(state.sourceMode, state.customSource);
  if (label === "Install destination") return formatDestinationMode(state.destinationMode);
  if (label === "Preset layers" || label === "Preset sources") return `${selectedPresetCount(state)} selected`;
  if (label === "Platforms") return `${state.platforms.length} selected`;
  if (label === "Backup") return state.backup ? "on" : "off";
  if (label === "Use latest build output") return state.rebuild ? "on" : "off";
  if (label === "Run preset extensions") return state.presetInstallExtensions ? "on" : "off";
  return label;
}

function renderSourceSelection(state: TuiState) {
  return renderCard("Select Source", "Choose which ULIS source tree the plan should read.", [
    selectableLabelValueLine(state.cursor, 0, "Project", ".ulis/ (repository-local config)"),
    selectableLabelValueLine(state.cursor, 1, "Global", "~/.ulis/ (home tool configs)"),
    selectableLabelValueLine(state.cursor, 2, "Custom", state.customSource || "Set custom path"),
    selectableLine(state.cursor, 3, "Back to plan"),
    { text: "" },
    {
      text: "Project and global choices also update the default install destination. You can still edit it on the plan.",
      fgColor: "color08",
    },
  ]);
}

function renderCustomSource(state: TuiState, handlers?: CustomSourceHandlers) {
  const recentLines: UiLine[] = [];
  if (state.recentCustomSources.length > 0) {
    recentLines.push({
      text: "Recent custom sources",
      fgColor: "color06",
      bold: true,
    });
    for (let index = 0; index < state.recentCustomSources.length; index++) {
      const source = state.recentCustomSources[index];
      if (!source) continue;
      recentLines.push(selectableLine(state.cursor, index + 1, source));
    }
    recentLines.push({ text: "" });
  }

  recentLines.push({
    text: state.notice || "Edit the path above. Enter saves. Up/Down moves to recents when present. Escape cancels.",
    fgColor: state.notice ? "color03" : "color08",
  });

  return renderCardShell("Custom Source Path", "Type a source directory path, then press Enter.", [
    VStack(
      {
        width: "100%",
        padding: { x: 1 },
        alignItems: "stretch",
      },
      [
        TextInput({
          value: state.textInput,
          focused: state.cursor === 0,
          minHeight: 2,
          maxHeight: 6,
          width: "100%",
          padding: { x: 1 },
          placeholder: Text("Path to .ulis or a parent directory…", {
            fgColor: "color08",
            italic: true,
          }),
          onChange: handlers?.onCustomSourceChange ?? (() => undefined),
          onKeyPress: handlers?.onCustomSourceKeyPress,
        }),
      ],
    ),
    ...recentLines.map(renderUiLine),
  ]);
}

function renderUiLine(line: UiLine): Node {
  return line.value == null
    ? VStack(
        {
          width: "100%",
          fgColor: line.fgColor,
          padding: { x: 1 + (line.indent ?? 0) },
          alignItems: "stretch",
        },
        [Text(line.text || " ", { bold: line.bold, wrap: "word" })],
      )
    : HStack(
        {
          width: "100%",
          fgColor: line.fgColor,
          padding: { x: 1 + (line.indent ?? 0) },
          alignItems: "start",
          justifyContent: "space-between",
        },
        [
          Text(line.text || " ", { bold: line.bold, wrap: "word" }),
          Text(line.value, {
            bold: line.bold,
            fgColor: "color06",
            wrap: "word",
          }),
        ],
      );
}

function renderCardShell(title: string, subtitle: string, children: readonly Node[]) {
  return VStack(
    {
      width: "92%",
      maxWidth: CARD_MAX_WIDTH,
      fgColor: "color07",
      gap: 0,
      alignItems: "stretch",
    },
    [
      VStack(
        {
          width: "100%",
          padding: { x: 1, y: 1 },
          alignItems: "stretch",
        },
        [Text(title, { bold: true, wrap: "word", fgColor: "color06" })],
      ),
      VStack(
        {
          width: "100%",
          padding: { x: 1 },
          alignItems: "stretch",
        },
        [Text(subtitle, { wrap: "word", fgColor: "color08" })],
      ),
      VStack(
        {
          width: "100%",
          padding: { x: 1 },
          alignItems: "stretch",
        },
        [Text(" ")],
      ),
      ...children,
      VStack(
        {
          width: "100%",
          fgColor: "color08",
          padding: { x: 1 },
          alignItems: "stretch",
        },
        [
          Text(
            "Controls: j/k or arrows to move, Enter to continue, Backspace to go back, x/space to toggle, q to quit",
            { wrap: "word" },
          ),
        ],
      ),
    ],
  );
}

function renderPresets(state: TuiState) {
  const lines: UiLine[] = [];
  const sourceRows = showsPresetSourcePicker(state) ? 1 : 0;
  if (sourceRows === 1) {
    lines.push(
      selectableLabelValueLine(state.cursor, 0, "Preset location", formatPresetSourceMode(state.presetSourceMode)),
      {
        text: "Press Enter or Space to cycle where preset folders are searched.",
        indent: 4,
        fgColor: "color08",
      },
      { text: "" },
    );
  }
  const presets = visiblePresetChoices(state);
  if (presets.length === 0) {
    lines.push({
      text: "No presets found in the selected location.",
      fgColor: "color03",
    });
  } else {
    let previousSource: string | undefined;
    for (let index = 0; index < presets.length; index++) {
      const preset = presets[index];
      if (!preset) continue;
      if (preset.source !== previousSource) {
        previousSource = preset.source;
        lines.push({
          text: formatPresetSourceHeading(preset.source),
          fgColor: "color06",
          bold: true,
        });
      }
      const checked = state.selectedPresetNames.includes(presetSelectionKey(state, preset)) ? "x" : " ";
      lines.push(selectableLine(state.cursor, index + sourceRows, `[${checked}] ${preset.name} (${preset.source})`));
      if (preset.description) lines.push({ text: preset.description, indent: 4, fgColor: "color08" });
    }
  }

  const continueIndex = presets.length + sourceRows;
  const backIndex = state.flow === "presetsOnly" ? continueIndex + 1 : continueIndex;
  lines.push({ text: "" });
  lines.push(
    selectableLine(state.cursor, continueIndex, state.flow === "presetsOnly" ? "Continue to plan" : "Back to plan"),
  );
  if (state.flow === "presetsOnly") lines.push(selectableLine(state.cursor, backIndex, "Back to start"));
  lines.push({ text: "" });
  lines.push({
    text:
      state.notice ||
      (state.flow === "presetsOnly"
        ? "Selected presets are the whole input. No base source will be read."
        : "Selected presets are applied before the base source for Validate, Build, and Install."),
    fgColor: state.notice ? "color03" : "color08",
  });

  return renderCard(
    state.flow === "presetsOnly" ? "Select Preset Sources" : "Select Preset Layers",
    state.flow === "presetsOnly"
      ? "Choose presets to install without reading a base source."
      : "Choose optional presets to merge before the base source.",
    lines,
  );
}

function formatPresetSourceHeading(source: string): string {
  if (source === "project") return "Project presets";
  if (source === "global" || source === "user") return "Global presets";
  return "Bundled presets";
}

function renderPlatforms(state: TuiState) {
  const lines: UiLine[] = [
    {
      text: `Selected: ${formatPlatforms(state.platforms)}`,
      fgColor: "color06",
      bold: true,
    },
    { text: "" },
    selectableLine(state.cursor, 0, `[${state.platforms.length === PLATFORMS.length ? "x" : " "}] All platforms`),
    {
      text: "Select every supported platform in one action.",
      indent: 4,
      fgColor: "color08",
    },
  ];

  for (let index = 0; index < PLATFORMS.length; index++) {
    const platform = PLATFORMS[index];
    if (!platform) continue;
    const rowIndex = index + 1;
    const checked = state.platforms.includes(platform) ? "x" : " ";
    lines.push(selectableLine(state.cursor, rowIndex, `[${checked}] ${PLATFORM_LABELS[platform]}`));
    lines.push({
      text: PLATFORM_DESCRIPTIONS[platform],
      indent: 4,
      fgColor: "color08",
    });
  }

  lines.push({ text: "" });
  lines.push(selectableLine(state.cursor, PLATFORMS.length + 1, "Back to plan"));
  return renderCard("Select Platforms", "Choose which platform configs this plan should operate on.", lines);
}

function renderMissingSource(state: TuiState) {
  const plan = planSource(state);
  const lines: UiLine[] = [
    {
      text: `Missing source: ${plan.sourceDir}`,
      fgColor: "color03",
      bold: true,
    },
    { text: "" },
  ];

  if (state.sourceMode !== "custom") {
    lines.push(selectableLine(state.cursor, 0, `Initialize ${formatSourceMode(state.sourceMode)}`));
    lines.push(selectableLine(state.cursor, 1, "Choose a different source"));
    lines.push(selectableLine(state.cursor, 2, "Back to plan"));
  } else {
    lines.push({
      text: "Custom sources cannot be initialized automatically because their project name and owner are unknown.",
    });
    lines.push(selectableLine(state.cursor, 0, "Choose a different source"));
    lines.push(selectableLine(state.cursor, 1, "Back to plan"));
  }

  return renderCard("Source Not Found", "The selected action needs a source tree before it can continue.", lines);
}

function renderInstallReview(state: TuiState) {
  const plan = planSource(state);
  return renderCard("Review Install", "Confirm install settings before anything is written.", [
    { text: `Source: ${plan.sourceDir}` },
    { text: `Destination: ${plan.destBase}` },
    { text: `Platforms: ${formatPlatforms(state.platforms)}` },
    { text: `Presets: ${formatPresets(state)}` },
    { text: `Command: ${formatInstallCommand(state)}`, fgColor: "color08" },
    { text: "" },
    selectableLine(state.cursor, 0, `[${state.backup ? "x" : " "}] Backup existing configs before install`),
    selectableLine(state.cursor, 1, `[${state.rebuild ? "x" : " "}] Use latest build output`),
    { text: "" },
    selectableLine(state.cursor, 2, "Start install"),
    selectableLine(state.cursor, 3, "Back to plan"),
  ]);
}

function renderPresetInstallReview(state: TuiState) {
  const plan = planSource(state);
  return renderCard("Review Preset Install", "Confirm preset install settings before anything is written.", [
    { text: `Preset location: ${formatPresetSourceMode(state.presetSourceMode)}` },
    { text: `Destination: ${plan.destBase}` },
    { text: `Platforms: ${formatPlatforms(state.platforms)}` },
    { text: `Presets: ${formatPresets(state)}` },
    { text: "Action: install selected preset directories resolved by the TUI", fgColor: "color08" },
    { text: "" },
    selectableLine(state.cursor, 0, `[${state.backup ? "x" : " "}] Backup existing configs before install`),
    selectableLine(state.cursor, 1, `[${state.presetInstallExtensions ? "x" : " "}] Run preset extensions`),
    { text: "" },
    selectableLine(state.cursor, 2, "Start preset install"),
    selectableLine(state.cursor, 3, "Back to presets"),
    { text: "" },
    {
      text: state.notice || "Preset install does not read or merge the current source.",
      fgColor: state.notice ? "color03" : "color08",
    },
  ]);
}

function renderLogLines(state: TuiState): UiLine[] {
  const recent = state.logs.slice(-40);
  if (recent.length === 0) return [{ text: "Waiting for log output...", fgColor: "color08" }];
  return recent.map((entry) => ({ text: entry }));
}

function renderCard(title: string, subtitle: string, lines: readonly UiLine[]) {
  return renderCardShell(title, subtitle, lines.map(renderUiLine));
}

function selectableLine(cursor: number, index: number, text: string): UiLine {
  const focused = cursor === index;
  return {
    text: `${focused ? ">" : " "} ${text}`,
    fgColor: focused ? "color06" : undefined,
    bold: focused,
  };
}

function formatPlatforms(platforms: readonly Platform[]): string {
  return platforms.length > 0 ? platforms.map((platform) => PLATFORM_LABELS[platform]).join(", ") : "none";
}

function formatInstallCommand(state: TuiState): string {
  const plan = planSource(state);
  const args = ["ulis", "install", "--source", plan.sourceDir, "--target", state.platforms.join(","), "--yes"];
  if (state.destinationMode === "global") args.push("--global");
  if (state.selectedPresetNames.length > 0) args.push("--preset", state.selectedPresetNames.join(","));
  if (!state.rebuild) args.push("--no-rebuild");
  if (state.backup) args.push("--backup");
  return args.map(quoteCommandArg).join(" ");
}

function selectedPresetCount(state: TuiState): number {
  return state.selectedPresetNames.filter((name) => visiblePresetChoices(state).some((preset) => preset.name === name))
    .length;
}

function quoteCommandArg(value: string): string {
  return /\s/u.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function planActionLine(state: TuiState, label: TuiPlanItem, index: number): UiLine {
  const selected = state.cursor === index;
  const value = planLabel(state, label);
  const hasValue = value !== label;
  return {
    text: `${selected ? ">" : " "} ${label}`,
    value: hasValue ? value : undefined,
    fgColor: selected ? "color06" : undefined,
    bold: selected,
  };
}

function selectableLabelValueLine(cursor: number, index: number, label: string, value: string): UiLine {
  const focused = cursor === index;
  return {
    text: `${focused ? ">" : " "} ${label}`,
    value,
    fgColor: focused ? "color06" : undefined,
    bold: focused,
  };
}
