import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { ULIS_SOURCE_DIRNAME } from "../config.js";
import { PLATFORMS, uniquePlatforms, type Platform } from "../platforms.js";
import type { PresetListEntry } from "../presets.js";
import type { ResolvedPreset } from "../utils/resolve-presets.js";

export type TuiScreen =
  | "flow"
  | "plan"
  | "source"
  | "customSource"
  | "presets"
  | "platforms"
  | "missingSource"
  | "installReview"
  | "presetInstallReview"
  | "running"
  | "result";

export type TuiAction = "validate" | "presetValidate" | "build" | "install" | "presetInstall" | "init";
export type TuiFlow = "project" | "global" | "custom" | "presetsOnly";
export type SourceMode = "project" | "global" | "custom";
export type DestinationMode = "project" | "global";
export type PresetSourceMode = "auto" | "project" | "global" | "bundled";
export type TuiPreferenceScope = TuiFlow;
export type TuiPlanItem =
  | "Preset layers"
  | "Preset sources"
  | "Base source"
  | "Platforms"
  | "Install destination"
  | "Backup"
  | "Use latest build output"
  | "Run preset extensions"
  | "Validate"
  | "Build only"
  | "Install"
  | "Back to start";

export interface PlannedSource {
  readonly sourceDir: string;
  readonly destBase: string;
  readonly sourceMode: SourceMode;
  readonly destinationMode: DestinationMode;
  readonly sourceExists: boolean;
  readonly globalInstall: boolean;
}

export interface TuiFlowPreferences {
  readonly destinationMode?: DestinationMode;
  readonly customSource?: string;
  readonly recentCustomSources?: readonly string[];
  readonly platforms?: readonly Platform[];
  readonly selectedPresetNames?: readonly string[];
  readonly presetSourceMode?: PresetSourceMode;
  readonly backup?: boolean;
  readonly rebuild?: boolean;
  readonly presetInstallExtensions?: boolean;
}

export interface TuiState {
  screen: TuiScreen;
  cursor: number;
  runningSpinnerFrame: number;
  flow: TuiFlow;
  sourceMode: SourceMode;
  destinationMode: DestinationMode;
  customSource: string;
  recentCustomSources: string[];
  textInput: string;
  platforms: Platform[];
  availablePresets: readonly PresetListEntry[];
  selectedPresetNames: string[];
  presetSourceMode: PresetSourceMode;
  backup: boolean;
  rebuild: boolean;
  presetInstallExtensions: boolean;
  flowPreferences: Partial<Record<TuiPreferenceScope, TuiFlowPreferences>>;
  logs: string[];
  notice: string;
  resultTitle: string;
  resultMessage: string;
  pendingAction?: Exclude<TuiAction, "init">;
}

type MutableFlowPreferences = {
  -readonly [Key in keyof TuiFlowPreferences]?: TuiFlowPreferences[Key];
};

export type TuiEffect =
  | { readonly type: "none" }
  | { readonly type: "exit"; readonly code: number }
  | { readonly type: "cancelRunning" }
  | { readonly type: "start"; readonly action: Exclude<TuiAction, "init"> }
  | { readonly type: "initSource" }
  | { readonly type: "pasteClipboard" };

type NavigationDirection = "up" | "down";

const KEY_DUPLICATE_WINDOW_MS = 35;
let lastKeyEvent: { readonly id: string; readonly at: number } | undefined;

export const DASHBOARD_ITEMS: readonly TuiPlanItem[] = [
  "Preset layers",
  "Base source",
  "Platforms",
  "Install destination",
  "Backup",
  "Use latest build output",
  "Validate",
  "Build only",
  "Install",
  "Back to start",
] as const;

const PRESET_ONLY_PLAN_ITEMS: readonly TuiPlanItem[] = [
  "Preset sources",
  "Platforms",
  "Install destination",
  "Backup",
  "Run preset extensions",
  "Validate",
  "Install",
  "Back to start",
] as const;

export const FLOW_ITEMS = [
  "Update this project",
  "Update global configs",
  "Use custom source",
  "Install presets only",
  "Quit",
] as const;

export function createInitialState(availablePresets: readonly PresetListEntry[] = []): TuiState {
  lastKeyEvent = undefined;
  return {
    screen: "flow",
    cursor: 0,
    runningSpinnerFrame: 0,
    flow: "project",
    sourceMode: "project",
    destinationMode: "project",
    customSource: "",
    recentCustomSources: [],
    textInput: "",
    platforms: [...PLATFORMS],
    availablePresets,
    selectedPresetNames: [],
    presetSourceMode: "auto",
    backup: true,
    rebuild: true,
    presetInstallExtensions: true,
    flowPreferences: {},
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
  const available = new Map(visiblePresetChoices(state).map((preset) => [preset.name, preset]));
  return state.selectedPresetNames.flatMap((name) => {
    const preset = available.get(name);
    return preset ? [{ name: preset.name, dir: preset.dir }] : [];
  });
}

export function formatSourceMode(mode: SourceMode, customSource?: string): string {
  if (mode === "project") return `Project ./${ULIS_SOURCE_DIRNAME}`;
  if (mode === "global") return `Global ~/${ULIS_SOURCE_DIRNAME}`;
  return customSource ? `Custom ${customSource}` : "Custom path";
}

export function formatDestinationMode(mode: DestinationMode): string {
  return mode === "global" ? "Global home configs" : "Project-local configs";
}

export function formatPresets(state: TuiState): string {
  const presets = selectedPresets(state).map((preset) => preset.name);
  return presets.length > 0 ? presets.join(", ") : "none";
}

export function formatPresetSourceMode(mode: PresetSourceMode): string {
  if (mode === "project") return "Project ./.ulis/presets";
  if (mode === "global") return "Global ~/.ulis/presets";
  if (mode === "bundled") return "Bundled presets";
  return "Auto project -> global -> bundled";
}

export function formatFlow(flow: TuiFlow): string {
  if (flow === "project") return "Update this project";
  if (flow === "global") return "Update global configs";
  if (flow === "custom") return "Use custom source";
  return "Install presets only";
}

export function isEditedPlan(state: TuiState): boolean {
  if (state.flow === "project") return state.sourceMode !== "project" || state.destinationMode !== "project";
  if (state.flow === "global") return state.sourceMode !== "global" || state.destinationMode !== "global";
  if (state.flow === "custom") return state.sourceMode !== "custom";
  return state.sourceMode !== "project";
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

export function normalizeCustomSourceInput(value: string, cwd: string = process.cwd()): string {
  const source = resolve(cwd, value.trim());
  if (basename(source) === ULIS_SOURCE_DIRNAME) return source;

  const childSource = join(source, ULIS_SOURCE_DIRNAME);
  return existsSync(childSource) ? childSource : source;
}

export function openCustomSourceInput(state: TuiState): void {
  state.textInput = state.customSource;
  state.recentCustomSources = rememberCustomSource(state.recentCustomSources, state.customSource);
  state.screen = "customSource";
  state.cursor = 0;
  state.notice = "";
}

export function togglePresetSelection(selected: readonly string[], presetName: string): string[] {
  return selected.includes(presetName) ? selected.filter((name) => name !== presetName) : [...selected, presetName];
}

export function visiblePresetChoices(state: TuiState): readonly PresetListEntry[] {
  if (!showsPresetSourcePicker(state)) {
    return dedupePresetChoices(
      state.availablePresets.filter(
        (preset) => presetSourceMatchesMode(preset.source, "global") || preset.source === "bundled",
      ),
    );
  }

  const mode = state.presetSourceMode;
  const filtered =
    mode === "auto"
      ? state.availablePresets
      : state.availablePresets.filter((preset) => presetSourceMatchesMode(preset.source, mode));
  return dedupePresetChoices(filtered);
}

export function showsPresetSourcePicker(state: TuiState): boolean {
  return state.flow === "presetsOnly";
}

function dedupePresetChoices(presets: readonly PresetListEntry[]): readonly PresetListEntry[] {
  const byName = new Map<string, PresetListEntry>();
  for (const preset of presets.slice().sort(comparePresetChoices)) {
    if (!byName.has(preset.name)) byName.set(preset.name, preset);
  }
  return [...byName.values()];
}

function presetSourceMatchesMode(source: PresetListEntry["source"], mode: Exclude<PresetSourceMode, "auto">): boolean {
  if (mode === "global") return source === "global" || source === "user";
  return source === mode;
}

function comparePresetChoices(a: PresetListEntry, b: PresetListEntry): number {
  const bySource = presetSourceRank(a.source) - presetSourceRank(b.source);
  return bySource === 0 ? a.name.localeCompare(b.name) : bySource;
}

function presetSourceRank(source: PresetListEntry["source"]): number {
  if (source === "project") return 0;
  if (source === "global" || source === "user") return 1;
  return 2;
}

function nextPresetSourceMode(mode: PresetSourceMode): PresetSourceMode {
  if (mode === "auto") return "project";
  if (mode === "project") return "global";
  if (mode === "global") return "bundled";
  return "auto";
}

export function planItems(state: TuiState): readonly TuiPlanItem[] {
  return state.flow === "presetsOnly" ? PRESET_ONLY_PLAN_ITEMS : DASHBOARD_ITEMS;
}

export function flowPreferencesFromState(state: TuiState): TuiFlowPreferences {
  const preferences: MutableFlowPreferences = {
    destinationMode: state.destinationMode,
    recentCustomSources: [...state.recentCustomSources],
    platforms: [...state.platforms],
    selectedPresetNames: [...state.selectedPresetNames],
    presetSourceMode: state.presetSourceMode,
    backup: state.backup,
    rebuild: state.rebuild,
    presetInstallExtensions: state.presetInstallExtensions,
  };

  if (state.flow === "custom" && state.customSource) preferences.customSource = state.customSource;

  return preferences;
}

export function storeCurrentFlowPreferences(state: TuiState): void {
  state.flowPreferences = {
    ...state.flowPreferences,
    [state.flow]: flowPreferencesFromState(state),
  };
}

export function applyFlowPreferences(state: TuiState, flow: TuiFlow = state.flow): void {
  const preferences = state.flowPreferences[flow];
  if (!preferences) return;

  if ((flow === "custom" || flow === "presetsOnly") && preferences.destinationMode) {
    state.destinationMode = preferences.destinationMode;
  }

  if (preferences.recentCustomSources) {
    state.recentCustomSources = [...preferences.recentCustomSources];
  }

  if (flow === "custom" && preferences.customSource) {
    state.customSource = preferences.customSource;
    state.recentCustomSources = rememberCustomSource(state.recentCustomSources, preferences.customSource);
  }

  if (preferences.platforms) {
    const platforms = uniquePlatforms(preferences.platforms);
    state.platforms = platforms.length > 0 ? platforms : [...PLATFORMS];
  }
  if (preferences.selectedPresetNames) {
    const availablePresetNames = new Set(state.availablePresets.map((preset) => preset.name));
    state.selectedPresetNames = [...new Set(preferences.selectedPresetNames)].filter((name) =>
      availablePresetNames.has(name),
    );
  }
  if (preferences.presetSourceMode) state.presetSourceMode = preferences.presetSourceMode;
  if (typeof preferences.backup === "boolean") state.backup = preferences.backup;
  if (typeof preferences.rebuild === "boolean") state.rebuild = preferences.rebuild;
  if (typeof preferences.presetInstallExtensions === "boolean") {
    state.presetInstallExtensions = preferences.presetInstallExtensions;
  }
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
  if (state.screen === "running") return isAnyKey(key, "q") ? { type: "cancelRunning" } : { type: "none" };
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
    case "flow":
      return handleFlowKey(state, key);
    case "plan":
      return handlePlanKey(state, key);
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
    case "presetInstallReview":
      return handlePresetInstallReviewKey(state, key);
    case "result":
      return handleResultKey(state, key);
  }
}

function navigateBack(state: TuiState): TuiEffect {
  if (
    state.screen === "plan" ||
    state.screen === "source" ||
    state.screen === "presets" ||
    state.screen === "platforms" ||
    state.screen === "missingSource"
  ) {
    state.screen = state.screen === "plan" ? "flow" : "plan";
    state.cursor = 0;
    state.notice = "";
    return { type: "none" };
  }

  if (state.screen === "installReview") {
    state.screen = "plan";
    state.cursor = planItemCursor(state, "Install");
    state.notice = "";
    return { type: "none" };
  }

  if (state.screen === "presetInstallReview") {
    state.screen = "plan";
    state.cursor = planItemCursor(state, "Install");
    state.notice = "";
    return { type: "none" };
  }

  if (state.screen === "result") {
    state.screen = "plan";
    state.cursor = 0;
    state.notice = "";
    state.pendingAction = undefined;
    return { type: "none" };
  }

  return { type: "none" };
}

function handleFlowKey(state: TuiState, key: string): TuiEffect {
  moveCursor(state, key, FLOW_ITEMS.length - 1);
  if (!isConfirmKey(key)) return { type: "none" };

  state.notice = "";
  if (state.cursor === 0) {
    applyFlowDefaults(state, "project");
    state.screen = "plan";
    state.cursor = 0;
  } else if (state.cursor === 1) {
    applyFlowDefaults(state, "global");
    state.screen = "plan";
    state.cursor = 0;
  } else if (state.cursor === 2) {
    applyFlowDefaults(state, "custom");
    openCustomSourceInput(state);
  } else if (state.cursor === 3) {
    applyFlowDefaults(state, "presetsOnly");
    state.screen = "presets";
    state.cursor = 0;
  } else {
    return { type: "exit", code: 0 };
  }

  return { type: "none" };
}

function handlePlanKey(state: TuiState, key: string): TuiEffect {
  const items = planItems(state);
  moveCursor(state, key, items.length - 1);
  const item = items[state.cursor];

  if (item === "Backup" && isToggleKey(key)) {
    state.backup = !state.backup;
    state.notice = "";
    return { type: "none" };
  }

  if (item === "Use latest build output" && isToggleKey(key)) {
    state.rebuild = !state.rebuild;
    state.notice = "";
    return { type: "none" };
  }

  if (item === "Run preset extensions" && isToggleKey(key)) {
    state.presetInstallExtensions = !state.presetInstallExtensions;
    state.notice = "";
    return { type: "none" };
  }

  if (item === "Install destination" && isToggleKey(key)) {
    state.destinationMode = state.destinationMode === "global" ? "project" : "global";
    state.notice = "";
    return { type: "none" };
  }

  if (!isConfirmKey(key)) return { type: "none" };

  state.notice = "";
  switch (item) {
    case "Preset layers":
    case "Preset sources":
      state.screen = "presets";
      state.cursor = 0;
      break;
    case "Base source":
      state.screen = "source";
      state.cursor = 0;
      break;
    case "Platforms":
      state.screen = "platforms";
      state.cursor = 0;
      break;
    case "Install destination":
      state.destinationMode = state.destinationMode === "global" ? "project" : "global";
      break;
    case "Backup":
      state.backup = !state.backup;
      break;
    case "Use latest build output":
      state.rebuild = !state.rebuild;
      break;
    case "Run preset extensions":
      state.presetInstallExtensions = !state.presetInstallExtensions;
      break;
    case "Validate":
      if (state.flow === "presetsOnly") return startPresetOnlyAction(state, "presetValidate");
      return startOrMissingSource(state, "validate");
    case "Build only":
      return startOrMissingSource(state, "build");
    case "Install":
      if (state.flow === "presetsOnly") return openPresetInstallReview(state);
      return startOrMissingSource(state, "install");
    case "Back to start":
      state.screen = "flow";
      state.cursor = 0;
      break;
  }
  return { type: "none" };
}

function applyFlowDefaults(state: TuiState, flow: TuiFlow): void {
  storeCurrentFlowPreferences(state);
  state.flow = flow;
  if (flow === "project") {
    state.sourceMode = "project";
    state.destinationMode = "project";
  } else if (flow === "global") {
    state.sourceMode = "global";
    state.destinationMode = "global";
  } else if (flow === "custom") {
    state.sourceMode = "custom";
    state.destinationMode = "project";
  } else {
    state.sourceMode = "project";
    state.destinationMode = "project";
  }
  applyFlowPreferences(state, flow);
}

function handleSourceKey(state: TuiState, key: string): TuiEffect {
  moveCursor(state, key, 3);
  if (!isConfirmKey(key)) return { type: "none" };

  if (state.cursor === 0) {
    state.sourceMode = "project";
    state.destinationMode = "project";
    state.screen = "plan";
  } else if (state.cursor === 1) {
    state.sourceMode = "global";
    state.destinationMode = "global";
    state.screen = "plan";
  } else if (state.cursor === 2) {
    openCustomSourceInput(state);
  } else {
    state.screen = "plan";
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
  const rawValue = state.textInput.trim();
  if (!rawValue) {
    state.notice = "Enter a custom source path first.";
    return false;
  }
  const value = normalizeCustomSourceInput(rawValue);
  state.customSource = value;
  state.recentCustomSources = rememberCustomSource(state.recentCustomSources, value);
  state.sourceMode = "custom";
  state.destinationMode = "project";
  state.flow = "custom";
  state.screen = "plan";
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
  const presets = visiblePresetChoices(state);
  const sourceRows = showsPresetSourcePicker(state) ? 1 : 0;
  const continueIndex = presets.length + sourceRows;
  const backIndex = state.flow === "presetsOnly" ? continueIndex + 1 : continueIndex;
  const lastIndex = backIndex;
  moveCursor(state, key, lastIndex);
  if (!isConfirmKey(key) && !isToggleKey(key)) return { type: "none" };

  if (sourceRows === 1 && state.cursor === 0) {
    state.presetSourceMode = nextPresetSourceMode(state.presetSourceMode);
    state.notice = "";
  } else if (state.cursor >= sourceRows && state.cursor < presets.length + sourceRows) {
    const preset = presets[state.cursor - sourceRows];
    if (preset) state.selectedPresetNames = togglePresetSelection(state.selectedPresetNames, preset.name);
    state.notice = "";
  } else if (state.cursor === continueIndex && state.flow === "presetsOnly") {
    return continuePresetOnlyFlow(state);
  } else if (state.cursor === backIndex) {
    state.screen = state.flow === "presetsOnly" ? "flow" : "plan";
    state.cursor = 0;
    state.notice = "";
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
    state.screen = "plan";
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
    state.screen = "plan";
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
    state.screen = "plan";
    state.cursor = planItemCursor(state, "Install");
  }
  return { type: "none" };
}

function handlePresetInstallReviewKey(state: TuiState, key: string): TuiEffect {
  moveCursor(state, key, 3);
  if (!isConfirmKey(key) && !isToggleKey(key)) return { type: "none" };

  if (state.cursor === 0) {
    state.backup = !state.backup;
  } else if (state.cursor === 1) {
    state.presetInstallExtensions = !state.presetInstallExtensions;
  } else if (state.cursor === 2) {
    if (state.platforms.length === 0) {
      state.notice = "Select at least one platform first.";
      return { type: "none" };
    }
    return { type: "start", action: "presetInstall" };
  } else {
    state.screen = "plan";
    state.cursor = planItemCursor(state, "Install");
  }
  return { type: "none" };
}

function planItemCursor(state: TuiState, item: TuiPlanItem): number {
  const index = planItems(state).indexOf(item);
  return index === -1 ? 0 : index;
}

function handleResultKey(state: TuiState, key: string): TuiEffect {
  if (isConfirmKey(key)) {
    state.screen = "plan";
    state.cursor = 0;
    state.notice = "";
    state.pendingAction = undefined;
  }
  return { type: "none" };
}

function startPresetOnlyAction(state: TuiState, action: "presetValidate"): TuiEffect {
  if (selectedPresets(state).length === 0) {
    state.notice = "Select at least one preset first.";
    return { type: "none" };
  }

  if (state.platforms.length === 0) {
    state.notice = "Select at least one platform first.";
    return { type: "none" };
  }

  return { type: "start", action };
}

function openPresetInstallReview(state: TuiState): TuiEffect {
  if (selectedPresets(state).length === 0) {
    state.notice = "Select at least one preset first.";
    return { type: "none" };
  }

  if (state.platforms.length === 0) {
    state.notice = "Select at least one platform first.";
    return { type: "none" };
  }

  state.screen = "presetInstallReview";
  state.cursor = 0;
  return { type: "none" };
}

function continuePresetOnlyFlow(state: TuiState): TuiEffect {
  if (selectedPresets(state).length === 0) {
    state.notice = "Select at least one preset first.";
    return { type: "none" };
  }

  state.screen = "plan";
  state.cursor = 0;
  state.notice = "";
  return { type: "none" };
}

function startOrMissingSource(state: TuiState, action: Exclude<TuiAction, "init" | "presetValidate">): TuiEffect {
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
