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
  recentCustomSources: string[];
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
  pendingAction?: Exclude<TuiAction, "init">;
}

export type TuiEffect =
  | { readonly type: "none" }
  | { readonly type: "exit"; readonly code: number }
  | { readonly type: "start"; readonly action: Exclude<TuiAction, "init"> }
  | { readonly type: "initSource" }
  | { readonly type: "pasteClipboard" };

type NavigationDirection = "up" | "down";

const KEY_DUPLICATE_WINDOW_MS = 35;
let lastKeyEvent: { readonly id: string; readonly at: number } | undefined;

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
  lastKeyEvent = undefined;
  return {
    screen: "dashboard",
    cursor: 0,
    runningSpinnerFrame: 0,
    sourceMode: "project",
    destinationMode: "project",
    customSource: "",
    recentCustomSources: [],
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

export function appendTextInput(state: TuiState, text: string): boolean {
  const value = textInputValue(text);
  if (value == null) return false;
  state.textInput += value;
  state.cursor = 0;
  state.notice = "";
  return true;
}

export function rememberCustomSource(recent: readonly string[], value: string): string[] {
  const normalized = value.trim();
  if (!normalized) return [...recent];
  return [normalized, ...recent.filter((entry) => entry !== normalized)].slice(0, 3);
}

export function openCustomSourceInput(state: TuiState): void {
  state.textInput = state.customSource;
  state.recentCustomSources = rememberCustomSource(state.recentCustomSources, state.customSource);
  state.screen = "customSource";
  state.cursor = 0;
  state.notice = "";
}

export function togglePresetSelection(selected: readonly string[], presetName: string): string[] {
  return selected.includes(presetName)
    ? selected.filter((name) => name !== presetName)
    : [...selected, presetName].sort();
}

export interface CustomSourceTextInputKeyResult {
  readonly effect: TuiEffect;
  /**
   * When true, the TextInput `onKeyPress` handler should return `false` to cel-tui
   * (consume the key and skip default editing / bubbling).
   */
  readonly preventDefault: boolean;
}

export function handleTuiKey(state: TuiState, key: string): TuiEffect {
  key = normalizeKey(key);
  if (state.screen === "running") return { type: "none" };
  if (isDuplicateKeyEvent(key)) return { type: "none" };

  if (isAnyKey(key, "ctrl+c", "q") && state.screen !== "customSource") {
    return { type: "exit", code: 0 };
  }

  if (isAnyKey(key, "backspace", "delete") && state.screen !== "customSource") {
    return navigateBack(state);
  }

  // Path row uses cel-tui TextInput; typing is driven by onChange, not root onKeyPress.
  if (state.screen === "customSource" && state.cursor === 0) {
    return { type: "none" };
  }

  switch (state.screen) {
    case "dashboard":
      return handleDashboardKey(state, key);
    case "source":
      return handleSourceKey(state, key);
    case "customSource":
      return handleCustomSourceListKey(state, key);
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
    openCustomSourceInput(state);
  } else {
    state.screen = "dashboard";
  }
  if (state.screen !== "customSource") {
    state.cursor = 0;
    state.notice = "";
  }
  return { type: "none" };
}

/** Called from TextInput `onKeyPress` when editing the custom path (cursor on path row). */
export function handleCustomSourceTextInputKey(state: TuiState, key: string): CustomSourceTextInputKeyResult {
  key = normalizeKey(key);
  if (state.screen !== "customSource" || state.cursor !== 0) {
    return { effect: { type: "none" }, preventDefault: false };
  }
  if (isDuplicateKeyEvent(key)) {
    return { effect: { type: "none" }, preventDefault: true };
  }

  const direction = getNavigationDirection(key);
  if (direction) {
    moveCursor(state, key, state.recentCustomSources.length);
    state.notice = "";
    return { effect: { type: "none" }, preventDefault: true };
  }

  if (isAnyKey(key, "escape")) {
    state.screen = "source";
    state.cursor = 2;
    return { effect: { type: "none" }, preventDefault: true };
  }

  if (isConfirmKey(key)) {
    commitCustomSourceIfValid(state);
    return { effect: { type: "none" }, preventDefault: true };
  }

  if (isPasteKey(key)) {
    return { effect: { type: "pasteClipboard" }, preventDefault: true };
  }

  return { effect: { type: "none" }, preventDefault: false };
}

/** Sync TextInput value from cel-tui `onChange` while on the custom path screen. */
export function applyCustomSourceTextInputChange(state: TuiState, value: string): void {
  if (state.screen !== "customSource") return;
  state.textInput = value;
  state.cursor = 0;
  state.notice = "";
}

function commitCustomSourceIfValid(state: TuiState): boolean {
  const value = state.textInput.trim();
  if (!value) {
    state.notice = "Enter a custom source path first.";
    return false;
  }
  state.customSource = value;
  state.recentCustomSources = rememberCustomSource(state.recentCustomSources, value);
  state.sourceMode = "custom";
  state.destinationMode = "project";
  state.screen = "dashboard";
  state.cursor = 0;
  state.notice = "";
  return true;
}

function handleCustomSourceListKey(state: TuiState, key: string): TuiEffect {
  moveCursor(state, key, state.recentCustomSources.length);
  if (getNavigationDirection(key)) return { type: "none" };

  if (isAnyKey(key, "escape")) {
    state.screen = "source";
    state.cursor = 2;
    return { type: "none" };
  }

  if (isAnyKey(key, "backspace", "delete")) {
    state.textInput = state.textInput.slice(0, -1);
    state.cursor = 0;
    return { type: "none" };
  }

  if (isConfirmKey(key)) {
    if (state.cursor > 0) {
      const selectedRecent = state.recentCustomSources[state.cursor - 1];
      if (selectedRecent) state.textInput = selectedRecent;
    }
    commitCustomSourceIfValid(state);
    return { type: "none" };
  }

  if (isPasteKey(key)) return { type: "pasteClipboard" };

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
  if (!direction) return;

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
  return isConfirmKey(key) || isAnyKey(key, "x", " ", "space");
}

function isPasteKey(key: string): boolean {
  return isAnyKey(key, "ctrl+v", "cmd+v", "command+v", "meta+v");
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

function isDuplicateKeyEvent(key: string): boolean {
  const id = keyEventId(key);
  const now = Date.now();
  const duplicate = lastKeyEvent != null && lastKeyEvent.id === id && now - lastKeyEvent.at <= KEY_DUPLICATE_WINDOW_MS;
  lastKeyEvent = { id, at: now };
  return duplicate;
}

function keyEventId(key: string): string {
  const direction = getNavigationDirection(key);
  if (direction) return `nav:${direction}`;
  if (isConfirmKey(key)) return "confirm";
  if (isPasteKey(key)) return "paste";
  if (isAnyKey(key, " ", "space")) return "space";
  return key;
}

function textInputValue(key: string): string | undefined {
  const text = key.replaceAll("\u001b[200~", "").replaceAll("\u001b[201~", "");
  if (text.length === 0 || /[\u0000-\u001f\u007f]/.test(text)) return undefined;
  return text;
}

function normalizeKey(rawKey: string): string {
  if (rawKey.length === 0) return rawKey;

  if (rawKey === "\u0003") return "ctrl+c";
  if (rawKey === "\u0016") return "ctrl+v";
  if (isAnyKey(rawKey, "\r", "\n")) return "enter";
  if (isAnyKey(rawKey, "\u007f", "\u0008")) return "backspace";
  if (rawKey === "\u001b[3~") return "delete";
  if (isAnyKey(rawKey, "\u001b[A", "\u001bOA")) return "up";
  if (isAnyKey(rawKey, "\u001b[B", "\u001bOB")) return "down";

  const lowered = rawKey.toLowerCase();
  if (isAnyKey(lowered, "return", "newline")) return "enter";
  if (isAnyKey(lowered, "spacebar")) return "space";
  if (isAnyKey(lowered, "arrowup")) return "up";
  if (isAnyKey(lowered, "arrowdown")) return "down";
  if (isAnyKey(lowered, "del")) return "delete";
  if (isAnyKey(lowered, "esc")) return "escape";

  return lowered.startsWith("ctrl+") ||
    lowered.startsWith("cmd+") ||
    lowered.startsWith("command+") ||
    lowered.startsWith("meta+")
    ? lowered
    : rawKey;
}
