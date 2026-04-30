import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { ULIS_SOURCE_DIRNAME } from "../config.js";
import { PLATFORMS, uniquePlatforms, type Platform } from "../platforms.js";
import type { PresetListEntry } from "../presets.js";
import type { ResolvedPreset } from "../utils/resolve-presets.js";

export type TuiScreen =
  | "dashboard"
  | "source"
  | "customSource"
  | "presets"
  | "platforms"
  | "missingSource"
  | "installReview"
  | "running"
  | "result";

export type TuiAction = "validate" | "build" | "install" | "init";
export type SourceMode = "project" | "global" | "custom";
export type DestinationMode = "project" | "global";

export interface PlannedSource {
  readonly sourceDir: string;
  readonly destBase: string;
  readonly sourceMode: SourceMode;
  readonly destinationMode: DestinationMode;
  readonly sourceExists: boolean;
  readonly globalInstall: boolean;
}

export interface TuiState {
  screen: TuiScreen;
  cursor: number;
  runningSpinnerFrame: number;
  sourceMode: SourceMode;
  destinationMode: DestinationMode;
  customSource: string;
  textInput: string;
  platforms: Platform[];
  availablePresets: readonly PresetListEntry[];
  selectedPresetNames: string[];
  backup: boolean;
  rebuild: boolean;
  logs: string[];
  notice: string;
  resultTitle: string;
  resultMessage: string;
  pendingAction?: TuiAction;
}

export type TuiEffect =
  | { readonly type: "none" }
  | { readonly type: "exit"; readonly code: number }
  | { readonly type: "start"; readonly action: Exclude<TuiAction, "init"> }
  | { readonly type: "initSource" };

type NavigationDirection = "up" | "down";

const NAV_DUPLICATE_WINDOW_MS = 40;
let lastNavigationEvent:
  | { readonly direction: NavigationDirection; readonly key: string; readonly at: number }
  | undefined;

export const DASHBOARD_ITEMS = [
  "Source",
  "Destination",
  "Presets",
  "Platforms",
  "Validate",
  "Build",
  "Install",
  "Quit",
] as const;

export function createInitialState(availablePresets: readonly PresetListEntry[] = []): TuiState {
  return {
    screen: "dashboard",
    cursor: 0,
    runningSpinnerFrame: 0,
    sourceMode: "project",
    destinationMode: "project",
    customSource: "",
    textInput: "",
    platforms: [...PLATFORMS],
    availablePresets,
    selectedPresetNames: [],
    backup: true,
    rebuild: true,
    logs: [],
    notice: "",
    resultTitle: "",
    resultMessage: "",
  };
}

export function planSource(state: TuiState, cwd: string = process.cwd(), userHome: string = homedir()): PlannedSource {
  const sourceDir =
    state.sourceMode === "global"
      ? join(userHome, ULIS_SOURCE_DIRNAME)
      : state.sourceMode === "custom"
        ? resolve(cwd, state.customSource)
        : join(cwd, ULIS_SOURCE_DIRNAME);

  const destBase =
    state.destinationMode === "global" ? userHome : state.sourceMode === "custom" ? dirname(sourceDir) : cwd;

  return {
    sourceDir,
    destBase,
    sourceMode: state.sourceMode,
    destinationMode: state.destinationMode,
    sourceExists: existsSync(sourceDir),
    globalInstall: state.destinationMode === "global",
  };
}

export function selectedPresets(state: TuiState): readonly ResolvedPreset[] {
  return state.selectedPresetNames
    .map((name) => state.availablePresets.find((preset) => preset.name === name))
    .filter((preset): preset is PresetListEntry => preset != null)
    .map((preset) => ({ name: preset.name, dir: preset.dir }));
}

export function formatSourceMode(mode: SourceMode): string {
  if (mode === "project") return `Project ./${ULIS_SOURCE_DIRNAME}`;
  if (mode === "global") return `Global ~/${ULIS_SOURCE_DIRNAME}`;
  return "Custom path";
}

export function formatDestinationMode(mode: DestinationMode): string {
  return mode === "global" ? "Global home configs" : "Project-local configs";
}

export function formatPresets(state: TuiState): string {
  return state.selectedPresetNames.length > 0 ? state.selectedPresetNames.join(", ") : "none";
}

export function togglePlatformSelection(selected: readonly Platform[], platform: Platform): Platform[] {
  const next = new Set(selected);
  if (next.has(platform)) {
    next.delete(platform);
  } else {
    next.add(platform);
  }
  return uniquePlatforms([...next]);
}

export function toggleAllPlatformSelections(selected: readonly Platform[]): Platform[] {
  return selected.length === PLATFORMS.length ? [] : [...PLATFORMS];
}

export function togglePresetSelection(selected: readonly string[], presetName: string): string[] {
  return selected.includes(presetName)
    ? selected.filter((name) => name !== presetName)
    : [...selected, presetName].sort();
}

export function handleTuiKey(state: TuiState, key: string): TuiEffect {
  if (state.screen === "running") return { type: "none" };

  if (isAnyKey(key, "ctrl+c", "q") && state.screen !== "customSource") {
    return { type: "exit", code: 0 };
  }

  if (isAnyKey(key, "backspace") && state.screen !== "customSource") {
    return navigateBack(state);
  }

  switch (state.screen) {
    case "dashboard":
      return handleDashboardKey(state, key);
    case "source":
      return handleSourceKey(state, key);
    case "customSource":
      return handleCustomSourceKey(state, key);
    case "presets":
      return handlePresetsKey(state, key);
    case "platforms":
      return handlePlatformsKey(state, key);
    case "missingSource":
      return handleMissingSourceKey(state, key);
    case "installReview":
      return handleInstallReviewKey(state, key);
    case "result":
      return handleResultKey(state, key);
  }
}

function navigateBack(state: TuiState): TuiEffect {
  if (
    state.screen === "source" ||
    state.screen === "presets" ||
    state.screen === "platforms" ||
    state.screen === "missingSource"
  ) {
    state.screen = "dashboard";
    state.cursor = 0;
    state.notice = "";
    return { type: "none" };
  }

  if (state.screen === "installReview") {
    state.screen = "dashboard";
    state.cursor = 6;
    state.notice = "";
    return { type: "none" };
  }

  if (state.screen === "result") {
    state.screen = "dashboard";
    state.cursor = 0;
    state.notice = "";
    state.pendingAction = undefined;
    return { type: "none" };
  }

  return { type: "none" };
}

function handleDashboardKey(state: TuiState, key: string): TuiEffect {
  moveCursor(state, key, DASHBOARD_ITEMS.length - 1);

  // Destination (index 1) is a real checkbox — accept toggle keys (x, space) as well as Enter
  if (state.cursor === 1 && isToggleKey(key)) {
    state.destinationMode = state.destinationMode === "global" ? "project" : "global";
    state.notice = "";
    return { type: "none" };
  }

  if (!isConfirmKey(key)) return { type: "none" };

  state.notice = "";
  switch (state.cursor) {
    case 0:
      state.screen = "source";
      state.cursor = 0;
      break;
    case 1:
      state.destinationMode = state.destinationMode === "global" ? "project" : "global";
      break;
    case 2:
      state.screen = "presets";
      state.cursor = 0;
      break;
    case 3:
      state.screen = "platforms";
      state.cursor = 0;
      break;
    case 4:
      return startOrMissingSource(state, "validate");
    case 5:
      return startOrMissingSource(state, "build");
    case 6:
      return startOrMissingSource(state, "install");
    case 7:
      return { type: "exit", code: 0 };
  }
  return { type: "none" };
}

function handleSourceKey(state: TuiState, key: string): TuiEffect {
  moveCursor(state, key, 3);
  if (!isConfirmKey(key)) return { type: "none" };

  if (state.cursor === 0) {
    state.sourceMode = "project";
    state.destinationMode = "project";
    state.screen = "dashboard";
  } else if (state.cursor === 1) {
    state.sourceMode = "global";
    state.destinationMode = "global";
    state.screen = "dashboard";
  } else if (state.cursor === 2) {
    state.textInput = state.customSource;
    state.screen = "customSource";
  } else {
    state.screen = "dashboard";
  }
  state.cursor = 0;
  state.notice = "";
  return { type: "none" };
}

function handleCustomSourceKey(state: TuiState, key: string): TuiEffect {
  if (isAnyKey(key, "escape")) {
    state.screen = "source";
    state.cursor = 2;
    return { type: "none" };
  }

  if (isAnyKey(key, "backspace", "delete")) {
    state.textInput = state.textInput.slice(0, -1);
    return { type: "none" };
  }

  if (isConfirmKey(key)) {
    const value = state.textInput.trim();
    if (!value) {
      state.notice = "Enter a custom source path first.";
      return { type: "none" };
    }
    state.customSource = value;
    state.sourceMode = "custom";
    state.destinationMode = "project";
    state.screen = "dashboard";
    state.cursor = 0;
    state.notice = "";
    return { type: "none" };
  }

  if (key.length === 1) {
    state.textInput += key;
    state.notice = "";
  }
  return { type: "none" };
}

function handlePresetsKey(state: TuiState, key: string): TuiEffect {
  const lastIndex = state.availablePresets.length;
  moveCursor(state, key, lastIndex);
  if (!isConfirmKey(key) && !isToggleKey(key)) return { type: "none" };

  if (state.cursor < state.availablePresets.length) {
    const preset = state.availablePresets[state.cursor];
    if (preset) state.selectedPresetNames = togglePresetSelection(state.selectedPresetNames, preset.name);
  } else {
    state.screen = "dashboard";
    state.cursor = 0;
  }
  return { type: "none" };
}

function handlePlatformsKey(state: TuiState, key: string): TuiEffect {
  const lastIndex = PLATFORMS.length + 1;
  moveCursor(state, key, lastIndex);
  if (!isConfirmKey(key) && !isToggleKey(key)) return { type: "none" };

  if (state.cursor === 0) {
    state.platforms = toggleAllPlatformSelections(state.platforms);
  } else if (state.cursor <= PLATFORMS.length) {
    const platform = PLATFORMS[state.cursor - 1];
    if (platform) state.platforms = togglePlatformSelection(state.platforms, platform);
  } else {
    state.screen = "dashboard";
    state.cursor = 0;
  }
  return { type: "none" };
}

function handleMissingSourceKey(state: TuiState, key: string): TuiEffect {
  moveCursor(state, key, state.sourceMode === "custom" ? 1 : 2);
  if (!isConfirmKey(key)) return { type: "none" };

  if (state.sourceMode !== "custom" && state.cursor === 0) {
    return { type: "initSource" };
  }

  // "Choose a different source" is always the first selectable action item
  const isChooseDifferent =
    (state.sourceMode === "custom" && state.cursor === 0) || (state.sourceMode !== "custom" && state.cursor === 1);

  if (isChooseDifferent) {
    state.screen = "source";
    state.cursor = 0;
  } else {
    state.screen = "dashboard";
    state.cursor = 0;
  }
  return { type: "none" };
}

function handleInstallReviewKey(state: TuiState, key: string): TuiEffect {
  moveCursor(state, key, 3);
  if (!isConfirmKey(key) && !isToggleKey(key)) return { type: "none" };

  if (state.cursor === 0) {
    state.backup = !state.backup;
  } else if (state.cursor === 1) {
    state.rebuild = !state.rebuild;
  } else if (state.cursor === 2) {
    return { type: "start", action: "install" };
  } else {
    state.screen = "dashboard";
    state.cursor = 6;
  }
  return { type: "none" };
}

function handleResultKey(state: TuiState, key: string): TuiEffect {
  if (isConfirmKey(key)) {
    state.screen = "dashboard";
    state.cursor = 0;
    state.notice = "";
    state.pendingAction = undefined;
  }
  return { type: "none" };
}

function startOrMissingSource(state: TuiState, action: Exclude<TuiAction, "init">): TuiEffect {
  if (state.platforms.length === 0) {
    state.notice = "Select at least one platform first.";
    return { type: "none" };
  }

  if (!planSource(state).sourceExists) {
    state.pendingAction = action;
    state.screen = "missingSource";
    state.cursor = 0;
    return { type: "none" };
  }

  if (action === "install") {
    state.screen = "installReview";
    state.cursor = 0;
    return { type: "none" };
  }

  return { type: "start", action };
}

function moveCursor(state: TuiState, key: string, lastIndex: number): void {
  const direction = getNavigationDirection(key);
  if (!direction || isDuplicateNavigationAlias(direction, key)) return;

  if (direction === "up") {
    state.cursor = (state.cursor + lastIndex) % (lastIndex + 1);
  } else {
    state.cursor = (state.cursor + 1) % (lastIndex + 1);
  }
}

function isAnyKey(key: string, ...candidates: readonly string[]): boolean {
  return candidates.includes(key);
}

function isConfirmKey(key: string): boolean {
  return isAnyKey(key, "enter");
}

function isToggleKey(key: string): boolean {
  return isAnyKey(key, "enter", "x", " ", "space");
}

function isUpKey(key: string): boolean {
  return isAnyKey(key, "k", "up", "arrowup");
}

function isDownKey(key: string): boolean {
  return isAnyKey(key, "j", "down", "arrowdown");
}

function getNavigationDirection(key: string): NavigationDirection | undefined {
  if (isUpKey(key)) return "up";
  if (isDownKey(key)) return "down";
  return undefined;
}

function isDuplicateNavigationAlias(direction: NavigationDirection, key: string): boolean {
  const now = Date.now();
  const duplicate =
    lastNavigationEvent != null &&
    lastNavigationEvent.direction === direction &&
    lastNavigationEvent.key !== key &&
    now - lastNavigationEvent.at <= NAV_DUPLICATE_WINDOW_MS;

  lastNavigationEvent = { direction, key, at: now };
  return duplicate;
}
