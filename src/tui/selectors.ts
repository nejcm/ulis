/**
 * Non-mutating selectors, formatters, and toggles derived from {@link TuiState}: no key handling,
 * and nothing here writes to `state` - the highest-value testable seam in the TUI. Not fully
 * side-effect-free, though: `planSource` and `normalizeCustomSourceInput` probe the filesystem via
 * `existsSync`, and several functions default their `cwd`/`userHome` parameters to
 * `process.cwd()`/`homedir()`.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { ULIS_SOURCE_DIRNAME } from "../config.js";
import { PLATFORMS, uniquePlatforms, type Platform } from "../platforms.js";
import type { PresetListEntry } from "../presets.js";
import { redactUserinfo } from "../utils/redact.js";
import { isRemoteSource } from "../utils/remote-source.js";
import type { ResolvedPreset } from "../utils/resolve-presets.js";
import {
  DASHBOARD_ITEMS,
  PRESET_ONLY_PLAN_ITEMS,
  type DestinationMode,
  type PlanItem,
  type PlannedSource,
  type PresetSourceMode,
  type SourceMode,
  type TuiFlow,
  type TuiState,
} from "./state-model.js";

export function planSource(state: TuiState, cwd: string = process.cwd(), userHome: string = homedir()): PlannedSource {
  // A remote custom source stays a URL: resolving it as a path would mangle it, and whether it
  // exists is only knowable by cloning, which planning must not do.
  const remote = state.sourceMode === "custom" && isRemoteSource(state.customSource);
  const sourceDir = remote
    ? state.customSource
    : state.sourceMode === "global"
      ? join(userHome, ULIS_SOURCE_DIRNAME)
      : state.sourceMode === "custom"
        ? resolve(cwd, state.customSource)
        : join(cwd, ULIS_SOURCE_DIRNAME);

  const destBase =
    state.destinationMode === "global"
      ? userHome
      : // A clone lives in a temp dir with no meaningful parent, so a remote source installs to cwd.
        state.sourceMode === "custom" && !remote
        ? dirname(sourceDir)
        : cwd;

  return {
    sourceDir,
    destBase,
    sourceMode: state.sourceMode,
    destinationMode: state.destinationMode,
    sourceExists: remote || existsSync(sourceDir),
    globalInstall: state.destinationMode === "global" ? true : undefined,
    remote,
  };
}

export function selectedPresets(state: TuiState): readonly ResolvedPreset[] {
  const available = new Map<string, PresetListEntry>();
  for (const preset of visiblePresetChoices(state)) {
    available.set(presetSelectionKey(state, preset), preset);
    if (!showsPresetSourcePicker(state)) available.set(preset.name, preset);
  }
  return state.selectedPresetNames.flatMap((selection) => {
    const preset = available.get(selection);
    return preset ? [{ name: preset.name, dir: preset.dir }] : [];
  });
}

/**
 * The preset ref to clone at action time, when the custom preset location is a URL rather than a
 * directory to scan. Resolution goes through `resolvePresets`, same as the CLI.
 */
export function remotePresetRef(state: TuiState): string | undefined {
  // Scoped to the flow it was entered in: a ref left over from the presets-only flow must not
  // silently attach itself to an unrelated custom-base install.
  return state.flow === "presetsOnly" && state.presetSourceMode === "custom" && isRemoteSource(state.customPresetSource)
    ? state.customPresetSource
    : undefined;
}

/**
 * Identity of everything that determines which remote commands will run. A review is only valid
 * for the exact settings it was generated from; if any of these change, the displayed commands may
 * no longer match what would execute, so the run must be refused until it is reviewed again.
 */
export function reviewFingerprint(
  state: TuiState,
  action: "install" | "presetInstall",
  cwd?: string,
  userHome?: string,
): string {
  const plan = planSource(state, cwd, userHome);
  return JSON.stringify([
    action,
    state.flow,
    plan.sourceDir,
    plan.destBase,
    plan.globalInstall,
    remotePresetRef(state) ?? "",
    // Order is part of the identity: presets merge in selection order, so the same set toggled in a
    // different order can run different extension commands.
    selectedPresets(state).map((preset) => preset.dir),
    [...state.platforms].sort(),
    state.presetInstallExtensions,
    state.skipExternalSkills,
    state.rebuild,
    state.prune,
    state.backup,
  ]);
}

/**
 * True when the run has something to install: a locally selected preset, or a remote ref that will
 * become one once cloned. A remote ref has no `PresetListEntry` until it is fetched, so guards that
 * only count `selectedPresets` would reject it as "nothing selected".
 */
export function hasPresetSelection(state: TuiState): boolean {
  return selectedPresets(state).length > 0 || remotePresetRef(state) != null;
}

export function formatSourceMode(mode: SourceMode, customSource?: string): string {
  if (mode === "project") return `Project ./${ULIS_SOURCE_DIRNAME}`;
  if (mode === "global") return `Global ~/${ULIS_SOURCE_DIRNAME}`;
  return customSource ? `Custom ${redactUserinfo(customSource)}` : "Custom path";
}

export function formatDestinationMode(mode: DestinationMode): string {
  return mode === "global" ? "Global home configs" : "Project-local configs";
}

export function formatPresets(state: TuiState): string {
  const presets = selectedPresets(state).map((preset) => preset.name);
  return presets.length > 0 ? presets.join(", ") : "none";
}

export function formatPresetSourceMode(mode: PresetSourceMode, customPresetSource?: string): string {
  if (mode === "project") return "Project ./.ulis/presets";
  if (mode === "global") return "Global ~/.ulis/presets";
  if (mode === "bundled") return "Bundled presets";
  if (mode === "custom") {
    return customPresetSource ? `Custom ${redactUserinfo(customPresetSource)}` : "Custom preset directory";
  }
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

export function rememberCustomSource(recent: readonly string[], value: string): string[] {
  // Recents are persisted and rendered, so a pasted password must never enter this list. The
  // credentialed value stays only in `state.customSource`, where the clone reads it.
  const normalized = redactUserinfo(value.trim());
  if (!normalized) return [...recent];
  return [normalized, ...recent.filter((entry) => entry !== normalized)].slice(0, 3);
}

export function normalizeCustomSourceInput(value: string, cwd: string = process.cwd()): string {
  const trimmed = value.trim();
  // A URL is not a path: no resolve(), and no `.ulis/` child probe.
  if (isRemoteSource(trimmed)) return trimmed;
  const source = resolve(cwd, trimmed);
  if (basename(source) === ULIS_SOURCE_DIRNAME) return source;

  const childSource = join(source, ULIS_SOURCE_DIRNAME);
  return existsSync(childSource) ? childSource : source;
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
      ? state.availablePresets.filter(
          (preset) => preset.source === "project" || presetSourceMatchesMode(preset.source, "global"),
        )
      : state.availablePresets.filter((preset) => presetSourceMatchesMode(preset.source, mode));
  return dedupePresetChoices(filtered);
}

export function showsPresetSourcePicker(state: TuiState): boolean {
  return state.flow === "presetsOnly";
}

export function presetSelectionKey(state: TuiState, preset: PresetListEntry): string {
  return showsPresetSourcePicker(state) ? presetSourceKey(preset) : preset.name;
}

export function presetSourceKey(preset: PresetListEntry): string {
  return `${preset.source}:${preset.name}`;
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
  if (source === "bundled") return 2;
  return 3;
}

export function nextPresetSourceMode(mode: PresetSourceMode): PresetSourceMode {
  if (mode === "auto") return "project";
  if (mode === "project") return "global";
  if (mode === "global") return "bundled";
  return "auto";
}

export function planItems(state: TuiState): readonly PlanItem[] {
  return state.flow === "presetsOnly" ? PRESET_ONLY_PLAN_ITEMS : DASHBOARD_ITEMS;
}
