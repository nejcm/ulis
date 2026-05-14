import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { PLATFORMS, uniquePlatforms, type Platform } from "../platforms.js";
import { rememberCustomSource, type DestinationMode, type SourceMode, type TuiState } from "./state.js";

export interface TuiPreferences {
  readonly sourceMode?: SourceMode;
  readonly destinationMode?: DestinationMode;
  readonly customSource?: string;
  readonly recentCustomSources?: readonly string[];
  readonly platforms?: readonly Platform[];
  readonly selectedPresetNames?: readonly string[];
  readonly backup?: boolean;
  readonly rebuild?: boolean;
}

const TUI_PREFERENCES_FILE = ".ulis-tui.json";

export function getTuiPreferencesPath(userHome: string = homedir()): string {
  return join(userHome, TUI_PREFERENCES_FILE);
}

export function snapshotTuiPreferences(state: TuiState): TuiPreferences {
  return {
    sourceMode: state.sourceMode,
    destinationMode: state.destinationMode,
    customSource: state.customSource,
    recentCustomSources: [...state.recentCustomSources],
    platforms: [...state.platforms],
    selectedPresetNames: [...state.selectedPresetNames],
    backup: state.backup,
    rebuild: state.rebuild,
  };
}

export function applyTuiPreferences(state: TuiState, preferences: TuiPreferences): void {
  if (isSourceMode(preferences.sourceMode)) state.sourceMode = preferences.sourceMode;
  if (isDestinationMode(preferences.destinationMode)) state.destinationMode = preferences.destinationMode;

  if (typeof preferences.customSource === "string") {
    state.customSource = preferences.customSource.trim();
  }

  if (Array.isArray(preferences.recentCustomSources)) {
    state.recentCustomSources = [...new Set(preferences.recentCustomSources)]
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim())
      .slice(0, 3);
  }

  state.recentCustomSources = rememberCustomSource(state.recentCustomSources, state.customSource);

  if (Array.isArray(preferences.platforms)) {
    const platforms = uniquePlatforms(preferences.platforms.filter(isPlatform));
    state.platforms = platforms;
  }

  if (Array.isArray(preferences.selectedPresetNames)) {
    const availablePresetNames = new Set(state.availablePresets.map((preset) => preset.name));
    state.selectedPresetNames = [...new Set(preferences.selectedPresetNames)]
      .filter((name): name is string => typeof name === "string" && availablePresetNames.has(name))
      .sort();
  }

  if (typeof preferences.backup === "boolean") state.backup = preferences.backup;
  if (typeof preferences.rebuild === "boolean") state.rebuild = preferences.rebuild;
}

export function loadTuiPreferences(state: TuiState, filePath: string = getTuiPreferencesPath()): string | undefined {
  if (!existsSync(filePath)) return;

  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    if (!isRecord(raw)) {
      return `Ignored TUI preferences at ${filePath} because the file is not a JSON object.`;
    }
    applyTuiPreferences(state, raw);
    return;
  } catch (error) {
    return `Unable to load TUI preferences from ${filePath}: ${formatError(error)}`;
  }
}

export function saveTuiPreferences(state: TuiState, filePath: string = getTuiPreferencesPath()): string | undefined {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(snapshotTuiPreferences(state), null, 2) + "\n", "utf-8");
    return;
  } catch (error) {
    return `Unable to save TUI preferences to ${filePath}: ${formatError(error)}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function isSourceMode(value: unknown): value is SourceMode {
  return value === "project" || value === "global" || value === "custom";
}

function isDestinationMode(value: unknown): value is DestinationMode {
  return value === "project" || value === "global";
}

function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && PLATFORMS.includes(value as Platform);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
