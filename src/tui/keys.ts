/**
 * The key-dispatch state machine: {@link handleTuiKey} and every per-screen `handle*Key`, plus
 * the text-input helpers and navigation used to get between screens. Depends on `./keys-review.js`
 * for the install/preset-install review screens; that module does not depend back on this one.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { PLATFORMS } from "../platforms.js";
import { isRemoteSource } from "../utils/remote-source.js";
import {
  getNavigationDirection,
  isAnyKey,
  isConfirmKey,
  isDuplicateKeyEvent,
  isPasteKey,
  isToggleKey,
  moveCursor,
  normalizeKey,
  textInputValue,
  type NavigationDirection,
} from "./key-codes.js";
import {
  clearRemoteReview,
  handleInstallReviewKey,
  handlePresetInstallReviewKey,
  leaveReview,
  openPresetInstallReview,
} from "./keys-review.js";
import { applyFlowPreferences, storeCurrentFlowPreferences } from "./preferences.js";
import {
  normalizeCustomSourceInput,
  nextPresetSourceMode,
  planItems,
  planSource,
  presetSelectionKey,
  hasPresetSelection,
  remotePresetRef,
  rememberCustomSource,
  showsPresetSourcePicker,
  toggleAllPlatformSelections,
  togglePlatformSelection,
  togglePresetSelection,
  visiblePresetChoices,
} from "./selectors.js";
import {
  assertNeverPlanItemId,
  FLOW_ITEMS,
  type TuiAction,
  type TuiEffect,
  type TuiFlow,
  type TuiScreen,
  type TuiState,
} from "./state-model.js";

export interface CustomSourceTextInputKeyResult {
  readonly effect: TuiEffect;
  /**
   * When true, the caller should consume the key and skip default editing /
   * bubbling instead of letting the input renderable handle it.
   */
  readonly preventDefault: boolean;
}

export function appendTextInput(state: TuiState, text: string): boolean {
  const value = textInputValue(text);
  if (value == null) return false;
  state.textInput += value;
  state.cursor = 0;
  state.notice = "";
  return true;
}

export function openCustomSourceInput(state: TuiState): void {
  state.textInput = state.customSource;
  state.recentCustomSources = rememberCustomSource(state.recentCustomSources, state.customSource);
  state.screen = "customSource";
  state.cursor = 0;
  state.notice = "";
}

export function openCustomPresetSourceInput(state: TuiState): void {
  state.textInput = state.customPresetSource;
  state.screen = "customPresetSource";
  state.cursor = 0;
  state.notice = "";
}

export function handleTuiKey(state: TuiState, key: string): TuiEffect {
  key = normalizeKey(key);
  if (state.screen === "running") return isAnyKey(key, "q") ? { type: "cancelRunning" } : { type: "none" };
  if (isDuplicateKeyEvent(key)) return { type: "none" };

  if (isAnyKey(key, "ctrl+c", "q") && !isPathInputScreen(state.screen)) {
    return { type: "exit", code: 0 };
  }

  if (isAnyKey(key, "backspace", "delete") && !isPathInputScreen(state.screen)) {
    return navigateBack(state);
  }

  // Path row uses the focused input renderable; typing is driven by its change
  // event, not by this root key handler.
  if (isPathInputScreen(state.screen) && state.cursor === 0) {
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
    case "customPresetSource":
      return { type: "none" };
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

  if (state.screen === "installReview" || state.screen === "presetInstallReview") {
    return leaveReview(state);
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
  let effect: TuiEffect;
  if (state.cursor === 0) {
    effect = applyFlowDefaults(state, "project");
    state.screen = "plan";
    state.cursor = 0;
  } else if (state.cursor === 1) {
    effect = applyFlowDefaults(state, "global");
    state.screen = "plan";
    state.cursor = 0;
  } else if (state.cursor === 2) {
    effect = applyFlowDefaults(state, "custom");
    openCustomSourceInput(state);
  } else if (state.cursor === 3) {
    effect = applyFlowDefaults(state, "presetsOnly");
    state.screen = "presets";
    state.cursor = 0;
    if (state.presetSourceMode === "custom" && state.customPresetSource) {
      return { type: "loadCustomPresetSource", path: state.customPresetSource, discardRemoteReview: true };
    }
  } else {
    return { type: "exit", code: 0 };
  }

  return effect;
}

function handlePlanKey(state: TuiState, key: string): TuiEffect {
  const items = planItems(state);
  moveCursor(state, key, items.length - 1);
  const item = items[state.cursor];
  // Defensive, not redundant: `moveCursor` returns without touching the cursor for any
  // non-navigation key, so a cursor left over from a previous, longer flow can still be
  // out of range here.
  if (!item) return { type: "none" };

  if (item.id === "backup" && isToggleKey(key)) {
    state.backup = !state.backup;
    state.notice = "";
    return { type: "none" };
  }

  if (item.id === "prune" && isToggleKey(key)) {
    state.prune = !state.prune;
    state.notice = "";
    return { type: "none" };
  }

  if (item.id === "rebuild" && isToggleKey(key)) {
    state.rebuild = !state.rebuild;
    state.notice = "";
    return { type: "none" };
  }

  if (item.id === "presetExtensions" && isToggleKey(key)) {
    state.presetInstallExtensions = !state.presetInstallExtensions;
    state.notice = "";
    return { type: "none" };
  }

  if (item.id === "skipExternalSkills" && isToggleKey(key)) {
    state.skipExternalSkills = !state.skipExternalSkills;
    state.notice = "";
    return { type: "none" };
  }

  if (item.id === "destination" && isToggleKey(key)) {
    state.destinationMode = state.destinationMode === "global" ? "project" : "global";
    state.notice = "";
    return { type: "none" };
  }

  if (!isConfirmKey(key)) return { type: "none" };

  state.notice = "";
  switch (item.id) {
    case "presets":
      state.screen = "presets";
      state.cursor = 0;
      break;
    case "source":
      state.screen = "source";
      state.cursor = 0;
      break;
    case "platforms":
      state.screen = "platforms";
      state.cursor = 0;
      break;
    case "destination":
      state.destinationMode = state.destinationMode === "global" ? "project" : "global";
      break;
    case "backup":
      state.backup = !state.backup;
      break;
    case "prune":
      state.prune = !state.prune;
      break;
    case "rebuild":
      state.rebuild = !state.rebuild;
      break;
    case "presetExtensions":
      state.presetInstallExtensions = !state.presetInstallExtensions;
      break;
    case "skipExternalSkills":
      state.skipExternalSkills = !state.skipExternalSkills;
      break;
    case "validate":
      if (state.flow === "presetsOnly") return startPresetOnlyAction(state, "presetValidate");
      return startOrMissingSource(state, "validate");
    case "build":
      return startOrMissingSource(state, "build");
    case "install":
      if (state.flow === "presetsOnly") return openPresetInstallReview(state);
      return startOrMissingSource(state, "install");
    case "back":
      state.screen = "flow";
      state.cursor = 0;
      break;
    default:
      assertNeverPlanItemId(item.id);
  }
  return { type: "none" };
}

function applyFlowDefaults(state: TuiState, flow: TuiFlow): TuiEffect {
  storeCurrentFlowPreferences(state);
  clearRemoteReview(state);
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
  if (flow !== "presetsOnly") {
    // Drop a preset location chosen for the presets-only flow so it cannot leak into this one.
    state.presetSourceMode = "auto";
    state.customPresetSource = "";
  }
  applyFlowPreferences(state, flow);
  return { type: "none", discardRemoteReview: true };
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
export function handleCustomSourceTextInputKey(
  state: TuiState,
  key: string,
  cwd: string = process.cwd(),
): CustomSourceTextInputKeyResult {
  key = normalizeKey(key);
  if (!isPathInputScreen(state.screen) || state.cursor !== 0) {
    return { effect: { type: "none" }, preventDefault: false };
  }

  const direction = getArrowNavigationDirection(key);
  if (direction && state.screen === "customSource") {
    moveCursor(state, key, state.recentCustomSources.length);
    state.notice = "";
    return { effect: { type: "none" }, preventDefault: true };
  }

  if (isAnyKey(key, "escape")) {
    state.screen = state.screen === "customPresetSource" ? "presets" : "source";
    state.cursor = state.screen === "presets" ? 0 : 2;
    return { effect: { type: "none" }, preventDefault: true };
  }

  if (isConfirmKey(key)) {
    const inputScreen = state.screen;
    if (inputScreen === "customPresetSource") {
      return { effect: commitCustomPresetSourceIfValid(state, cwd), preventDefault: true };
    }
    commitCustomSourceIfValid(state);
    return { effect: { type: "none" }, preventDefault: true };
  }

  return { effect: { type: "none" }, preventDefault: false };
}

/** Sync the editor value from the input renderable's change event on the custom path screen. */
export function applyCustomSourceTextInputChange(state: TuiState, value: string): void {
  if (!isPathInputScreen(state.screen)) return;
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

function commitCustomPresetSourceIfValid(state: TuiState, cwd: string): TuiEffect {
  const rawValue = state.textInput.trim();
  if (!rawValue) {
    state.notice = "Enter a custom preset directory first.";
    return { type: "none" };
  }
  if (isRemoteSource(rawValue)) {
    // A remote preset ref is a ref, not a root to scan: there is nothing to list until it is
    // cloned, so it is resolved at action time instead of here.
    state.customPresetSource = rawValue;
    state.presetSourceMode = "custom";
    state.screen = "presets";
    state.cursor = 0;
    state.notice = "";
    return { type: "none" };
  }
  const value = resolve(cwd, rawValue);
  if (!existsSync(value)) {
    state.notice = `Custom preset directory does not exist: ${value}`;
    return { type: "none" };
  }
  state.customPresetSource = value;
  state.presetSourceMode = "custom";
  state.screen = "presets";
  state.cursor = 0;
  state.notice = "";
  return { type: "loadCustomPresetSource", path: value };
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
    if (isAnyKey(key, " ", "space")) {
      state.presetSourceMode = nextPresetSourceMode(state.presetSourceMode);
    } else if (isConfirmKey(key)) {
      openCustomPresetSourceInput(state);
    }
    state.notice = "";
  } else if (state.cursor >= sourceRows && state.cursor < presets.length + sourceRows) {
    const preset = presets[state.cursor - sourceRows];
    if (preset)
      state.selectedPresetNames = togglePresetSelection(state.selectedPresetNames, presetSelectionKey(state, preset));
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

function isPathInputScreen(screen: TuiScreen): boolean {
  return screen === "customSource" || screen === "customPresetSource";
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
  if (!hasPresetSelection(state)) {
    state.notice = "Select at least one preset first.";
    return { type: "none" };
  }

  if (state.platforms.length === 0) {
    state.notice = "Select at least one platform first.";
    return { type: "none" };
  }

  return { type: "start", action };
}

function continuePresetOnlyFlow(state: TuiState): TuiEffect {
  if (!hasPresetSelection(state)) {
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

  if (action === "build" && planSource(state).remote) {
    // `ulis build` refuses a remote source, so running it would only leak the URL - credentials
    // included - into the child's argv on the way to a guaranteed error.
    state.notice =
      "Build writes generated output into the source tree, so it cannot run against a remote source. Use Install instead.";
    return { type: "none" };
  }

  if (!planSource(state).sourceExists) {
    state.pendingAction = action;
    state.screen = "missingSource";
    state.cursor = 0;
    return { type: "none" };
  }

  if (action === "install") {
    // A remote source must show what it will run before it runs it, and that list only exists once
    // the tree is cloned - so the clone happens on the way into the review screen.
    // `remotePresetRef` is presets-only, which `handlePlanKey` routes to `openPresetInstallReview`
    // before it reaches here; it stays as the single "is anything remote?" test at this gate.
    if (planSource(state).remote || remotePresetRef(state)) {
      return { type: "prepareRemoteInstall", action: "install" };
    }
    state.screen = "installReview";
    state.cursor = 0;
    return { type: "none" };
  }

  return { type: "start", action };
}

function getArrowNavigationDirection(key: string): NavigationDirection | undefined {
  if (isAnyKey(key, "up", "arrowup")) return "up";
  if (isAnyKey(key, "down", "arrowdown")) return "down";
  return undefined;
}
