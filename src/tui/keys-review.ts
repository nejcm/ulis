/**
 * Install/preset-install review screen key handling: the two `handle*Key` screens plus
 * `leaveReview`, the generic "back out of a review" transition `./keys.js` calls from
 * `navigateBack`. Split out of `./keys.js` because it was the single largest chunk of that file.
 * This module does not depend back on `./keys.js` - the dependency runs one way.
 */
import { isConfirmKey, isToggleKey, moveCursor } from "./key-codes.js";
import { hasPresetSelection, planItems, remotePresetRef } from "./selectors.js";
import {
  PRESET_INSTALL_REVIEW_BACK_ROW,
  PRESET_INSTALL_REVIEW_START_ROW,
  type PlanItemId,
  type TuiEffect,
  type TuiState,
} from "./state-model.js";

export function handleInstallReviewKey(state: TuiState, key: string): TuiEffect {
  moveCursor(state, key, 1);
  if (!isConfirmKey(key)) return { type: "none" };

  if (state.cursor === 0) {
    return { type: "start", action: "install" };
  }
  return leaveReview(state);
}

export function handlePresetInstallReviewKey(state: TuiState, key: string): TuiEffect {
  moveCursor(state, key, PRESET_INSTALL_REVIEW_BACK_ROW);
  if (!(state.cursor < PRESET_INSTALL_REVIEW_START_ROW ? isToggleKey(key) : isConfirmKey(key))) {
    return { type: "none" };
  }

  // Every toggle on this screen is part of {@link reviewFingerprint}, so flipping one would
  // invalidate the very review it is displayed on. Re-preparing regenerates the command list from
  // the clone already on disk, so the screen keeps showing what the install will actually run.
  const reprepare: TuiEffect = remotePresetRef(state)
    ? { type: "prepareRemoteInstall", action: "presetInstall" }
    : { type: "none" };

  if (state.cursor === 0) {
    state.backup = !state.backup;
    return reprepare;
  } else if (state.cursor === 1) {
    state.prune = !state.prune;
    return reprepare;
  } else if (state.cursor === 2) {
    state.presetInstallExtensions = !state.presetInstallExtensions;
    return reprepare;
  } else if (state.cursor === PRESET_INSTALL_REVIEW_START_ROW) {
    if (state.platforms.length === 0) {
      state.notice = "Select at least one platform first.";
      return { type: "none" };
    }
    return { type: "start", action: "presetInstall" };
  }
  return leaveReview(state);
}

export function openPresetInstallReview(state: TuiState): TuiEffect {
  if (!hasPresetSelection(state)) {
    state.notice = "Select at least one preset first.";
    return { type: "none" };
  }

  if (state.platforms.length === 0) {
    state.notice = "Select at least one platform first.";
    return { type: "none" };
  }

  if (remotePresetRef(state)) {
    return { type: "prepareRemoteInstall", action: "presetInstall" };
  }

  state.screen = "presetInstallReview";
  state.cursor = PRESET_INSTALL_REVIEW_START_ROW;
  return { type: "none" };
}

export function leaveReview(state: TuiState): TuiEffect {
  state.screen = "plan";
  state.cursor = planItemCursor(state, "install");
  state.notice = "";
  clearRemoteReview(state);
  return { type: "none", discardRemoteReview: true };
}

function planItemCursor(state: TuiState, id: PlanItemId): number {
  const index = planItems(state).findIndex((item) => item.id === id);
  return index === -1 ? 0 : index;
}

export function clearRemoteReview(state: TuiState): void {
  state.remoteCommands = [];
  state.remoteCommandSource = "";
}
