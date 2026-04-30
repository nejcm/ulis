import { HStack, Text, VStack, type Color } from "@cel-tui/core";

import { PLATFORM_DESCRIPTIONS, PLATFORM_LABELS, PLATFORMS, type Platform } from "../platforms.js";
import {
  DASHBOARD_ITEMS,
  formatDestinationMode,
  formatPresets,
  formatSourceMode,
  planSource,
  type TuiState,
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

export function renderScreen(state: TuiState) {
  switch (state.screen) {
    case "dashboard":
      return renderDashboard(state);
    case "source":
      return renderSourceSelection(state);
    case "customSource":
      return renderCustomSource(state);
    case "presets":
      return renderPresets(state);
    case "platforms":
      return renderPlatforms(state);
    case "missingSource":
      return renderMissingSource(state);
    case "installReview":
      return renderInstallReview(state);
    case "running":
      return renderRunning(state);
    case "result":
      return renderCard(state.resultTitle, state.resultMessage, [
        { text: "Recent log output", fgColor: "color06", bold: true },
        { text: "" },
        ...renderLogLines(state),
        { text: "" },
        {
          text: "Press Enter to return to the dashboard, or q to quit.",
          fgColor: "color06",
          bold: true,
        },
      ]);
  }
}

function renderRunning(state: TuiState) {
  const frames = ["|", "/", "-", "\\"];
  const spinner = frames[state.runningSpinnerFrame % frames.length] ?? "|";
  return renderCard(`Running ${spinner}`, "The selected workflow is in progress.", renderLogLines(state));
}

function renderDashboard(state: TuiState) {
  const plan = planSource(state);
  const rows: UiLine[] = DASHBOARD_ITEMS.flatMap((label, index) => {
    const row = dashboardActionLine(state, label, index);
    return index === 3 ? [row, { text: "" }] : [row];
  });

  return renderCard(TITLE, SUBTITLE, [
    { text: "Current plan", fgColor: "color06", bold: true },
    { text: `Source: ${formatSourceMode(state.sourceMode)} -> ${plan.sourceDir}` },
    { text: `Destination: ${formatDestinationMode(state.destinationMode)} -> ${plan.destBase}` },
    { text: `Platforms: ${formatPlatforms(state.platforms)}` },
    { text: "" },
    { text: `Presets: ${formatPresets(state)}` },
    { text: `Backup: ${state.backup ? "on" : "off"}` },
    { text: `Rebuild before install: ${state.rebuild ? "on" : "off"}` },
    { text: "" },
    { text: "Actions", fgColor: "color06", bold: true },
    { text: "" },
    ...rows,
    { text: "" },
    {
      text: state.notice || "Tip: validate checks source and presets without writing generated files.",
      fgColor: state.notice ? "color03" : "color08",
    },
  ]);
}

function dashboardLabel(state: TuiState, label: (typeof DASHBOARD_ITEMS)[number]): string {
  if (label === "Source") return formatSourceMode(state.sourceMode);
  if (label === "Destination") return formatDestinationMode(state.destinationMode);
  if (label === "Presets") return `${state.selectedPresetNames.length} selected`;
  if (label === "Platforms") return `${state.platforms.length} selected`;
  return label;
}

function renderSourceSelection(state: TuiState) {
  return renderCard("Select Source", "Choose which ULIS source tree the dashboard should read.", [
    selectableLabelValueLine(state.cursor, 0, "Project", ".ulis/ (repository-local config)"),
    selectableLabelValueLine(state.cursor, 1, "Global", "~/.ulis/ (home tool configs)"),
    selectableLabelValueLine(state.cursor, 2, "Custom", state.customSource || "Set custom path"),
    selectableLine(state.cursor, 3, "Back to dashboard"),
    { text: "" },
    { text: "Project and global choices also update the default install destination.", fgColor: "color08" },
  ]);
}

function renderCustomSource(state: TuiState) {
  return renderCard("Custom Source Path", "Type a source directory path, then press Enter.", [
    { text: `Path: ${state.textInput || "_"}`, fgColor: "color06", bold: true },
    { text: "" },
    {
      text: state.notice || "Use Backspace to edit. Press Escape to cancel.",
      fgColor: state.notice ? "color03" : "color08",
    },
  ]);
}

function renderPresets(state: TuiState) {
  const lines: UiLine[] = [];
  if (state.availablePresets.length === 0) {
    lines.push({ text: "No user-global or bundled presets found.", fgColor: "color03" });
  } else {
    for (let index = 0; index < state.availablePresets.length; index++) {
      const preset = state.availablePresets[index];
      if (!preset) continue;
      const checked = state.selectedPresetNames.includes(preset.name) ? "x" : " ";
      lines.push(selectableLine(state.cursor, index, `[${checked}] ${preset.name} (${preset.source})`));
      if (preset.description) lines.push({ text: preset.description, indent: 4, fgColor: "color08" });
    }
  }

  const doneIndex = state.availablePresets.length;
  lines.push({ text: "" });
  lines.push(selectableLine(state.cursor, doneIndex, "Back to dashboard"));
  lines.push({ text: "" });
  lines.push({
    text: "Selected presets are applied before the base source, so the base source wins on conflicts.",
    fgColor: "color08",
  });

  return renderCard("Select Presets", "Choose optional presets for Validate, Build, and Install.", lines);
}

function renderPlatforms(state: TuiState) {
  const lines: UiLine[] = [
    { text: `Selected: ${formatPlatforms(state.platforms)}`, fgColor: "color06", bold: true },
    { text: "" },
    selectableLine(state.cursor, 0, `[${state.platforms.length === PLATFORMS.length ? "x" : " "}] All platforms`),
    { text: "Select every supported platform in one action.", indent: 4, fgColor: "color08" },
  ];

  for (let index = 0; index < PLATFORMS.length; index++) {
    const platform = PLATFORMS[index];
    if (!platform) continue;
    const rowIndex = index + 1;
    const checked = state.platforms.includes(platform) ? "x" : " ";
    lines.push(selectableLine(state.cursor, rowIndex, `[${checked}] ${PLATFORM_LABELS[platform]}`));
    lines.push({ text: PLATFORM_DESCRIPTIONS[platform], indent: 4, fgColor: "color08" });
  }

  lines.push({ text: "" });
  lines.push(selectableLine(state.cursor, PLATFORMS.length + 1, "Back to dashboard"));
  return renderCard("Select Platforms", "Choose which platform configs this dashboard should operate on.", lines);
}

function renderMissingSource(state: TuiState) {
  const plan = planSource(state);
  const lines: UiLine[] = [{ text: `Missing source: ${plan.sourceDir}`, fgColor: "color03", bold: true }, { text: "" }];

  if (state.sourceMode !== "custom") {
    lines.push(selectableLine(state.cursor, 0, `Initialize ${formatSourceMode(state.sourceMode)}`));
    lines.push(selectableLine(state.cursor, 1, "Choose a different source"));
    lines.push(selectableLine(state.cursor, 2, "Back to dashboard"));
  } else {
    lines.push({
      text: "Custom sources cannot be initialized automatically because their project name and owner are unknown.",
    });
    lines.push(selectableLine(state.cursor, 0, "Choose a different source"));
    lines.push(selectableLine(state.cursor, 1, "Back to dashboard"));
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
    { text: "" },
    selectableLine(state.cursor, 0, `[${state.backup ? "x" : " "}] Backup existing configs before install`),
    selectableLine(state.cursor, 1, `[${state.rebuild ? "x" : " "}] Rebuild before install`),
    { text: "" },
    selectableLine(state.cursor, 2, "Start install"),
    selectableLine(state.cursor, 3, "Back to dashboard"),
  ]);
}

function renderLogLines(state: TuiState): UiLine[] {
  const recent = state.logs.slice(-40);
  if (recent.length === 0) return [{ text: "Waiting for log output...", fgColor: "color08" }];
  return recent.map((entry) => ({ text: entry }));
}

function renderCard(title: string, subtitle: string, lines: readonly UiLine[]) {
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
      ...lines.map((line) =>
        line.value == null
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
                Text(line.value, { bold: line.bold, fgColor: "color06", wrap: "word" }),
              ],
            ),
      ),
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

function dashboardActionLine(state: TuiState, label: (typeof DASHBOARD_ITEMS)[number], index: number): UiLine {
  const selected = state.cursor === index;
  const value = dashboardLabel(state, label);
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
