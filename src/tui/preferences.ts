import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { PLATFORMS, uniquePlatforms, type Platform } from "../platforms.js";
import {
  applyFlowPreferences,
  rememberCustomSource,
  storeCurrentFlowPreferences,
  type DestinationMode,
  type PresetSourceMode,
  type SourceMode,
  type TuiFlow,
  type TuiFlowPreferences,
  type TuiState,
} from "./state.js";

export interface TuiPreferences {
  readonly version?: number;
  readonly scopes?: Partial<Record<TuiFlow, TuiFlowPreferences>>;
  readonly sourceMode?: SourceMode;
  readonly destinationMode?: DestinationMode;
  readonly customSource?: string;
  readonly recentCustomSources?: readonly string[];
  readonly platforms?: readonly Platform[];
  readonly selectedPresetNames?: readonly string[];
  readonly presetSourceMode?: PresetSourceMode;
  readonly backup?: boolean;
  readonly prune?: boolean;
  readonly rebuild?: boolean;
  readonly presetInstallExtensions?: boolean;
}

const TUI_PREFERENCES_FILE = ".ulis-tui.json";
const TUI_PREFERENCES_VERSION = 2;
type MutableFlowPreferences = {
  -readonly [Key in keyof TuiFlowPreferences]?: TuiFlowPreferences[Key];
};

export function getTuiPreferencesPath(userHome: string = homedir()): string {
  return join(userHome, TUI_PREFERENCES_FILE);
}

export function snapshotTuiPreferences(state: TuiState): TuiPreferences {
  storeCurrentFlowPreferences(state);
  return {
    version: TUI_PREFERENCES_VERSION,
    scopes: { ...state.flowPreferences },
  };
}

export function applyTuiPreferences(state: TuiState, preferences: TuiPreferences): void {
  if (typeof preferences.version === "number" && preferences.version > TUI_PREFERENCES_VERSION) return;

  state.flowPreferences = parsePreferenceScopes(preferences.scopes);

  const legacyPreferences = legacyFlowPreferences(state, preferences);
  if (legacyPreferences) {
    const legacyScope = isSourceMode(preferences.sourceMode) ? preferences.sourceMode : "project";
    state.flowPreferences = {
      ...state.flowPreferences,
      [legacyScope]: {
        ...legacyPreferences,
        ...state.flowPreferences[legacyScope],
      },
    };
  }

  applyFlowPreferences(state, state.flow);
}

function legacyFlowPreferences(state: TuiState, preferences: TuiPreferences): TuiFlowPreferences | undefined {
  const next: MutableFlowPreferences = {};
  if (typeof preferences.customSource === "string") {
    next.customSource = preferences.customSource.trim();
  }

  if (Array.isArray(preferences.recentCustomSources)) {
    next.recentCustomSources = [...new Set(preferences.recentCustomSources)]
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim())
      .slice(0, 3);
  }

  if (next.customSource)
    next.recentCustomSources = rememberCustomSource(next.recentCustomSources ?? [], next.customSource);

  if (Array.isArray(preferences.platforms)) {
    const platforms = uniquePlatforms(preferences.platforms.filter(isPlatform));
    next.platforms = platforms;
  }

  if (Array.isArray(preferences.selectedPresetNames)) {
    const availablePresetNames = new Set(state.availablePresets.map((preset) => preset.name));
    next.selectedPresetNames = [...new Set(preferences.selectedPresetNames)].filter(
      (name): name is string => typeof name === "string" && availablePresetNames.has(name),
    );
  }
  if (typeof preferences.presetSourceMode === "string" && isPresetSourceMode(preferences.presetSourceMode)) {
    next.presetSourceMode = preferences.presetSourceMode;
  }

  if (typeof preferences.destinationMode === "string" && isDestinationMode(preferences.destinationMode)) {
    next.destinationMode = preferences.destinationMode;
  }
  if (typeof preferences.backup === "boolean") next.backup = preferences.backup;
  if (typeof preferences.prune === "boolean") next.prune = preferences.prune;
  if (typeof preferences.rebuild === "boolean") next.rebuild = preferences.rebuild;
  if (typeof preferences.presetInstallExtensions === "boolean") {
    next.presetInstallExtensions = preferences.presetInstallExtensions;
  }

  return Object.keys(next).length > 0 ? next : undefined;
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
    // Bun's `mkdirSync(".", { recursive: true })` throws EEXIST where Node does not.
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(snapshotTuiPreferences(state), null, 2) + "\n", "utf-8");
    return;
  } catch (error) {
    return `Unable to save TUI preferences to ${filePath}: ${formatError(error)}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function isTuiFlow(value: unknown): value is TuiFlow {
  return value === "project" || value === "global" || value === "custom" || value === "presetsOnly";
}

function isSourceMode(value: unknown): value is SourceMode {
  return value === "project" || value === "global" || value === "custom";
}

function isDestinationMode(value: unknown): value is DestinationMode {
  return value === "project" || value === "global";
}

function isPresetSourceMode(value: unknown): value is PresetSourceMode {
  return value === "auto" || value === "project" || value === "global" || value === "bundled" || value === "custom";
}

function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && PLATFORMS.includes(value as Platform);
}

function parsePreferenceScopes(value: unknown): Partial<Record<TuiFlow, TuiFlowPreferences>> {
  if (!isRecord(value)) return {};

  const scopes: Partial<Record<TuiFlow, TuiFlowPreferences>> = {};
  for (const [scope, rawPreferences] of Object.entries(value)) {
    if (!isTuiFlow(scope) || !isRecord(rawPreferences)) continue;
    scopes[scope] = sanitizeFlowPreferences(rawPreferences);
  }
  return scopes;
}

function sanitizeFlowPreferences(raw: Record<string, unknown>): TuiFlowPreferences {
  const next: MutableFlowPreferences = {};

  if (isDestinationMode(raw.destinationMode)) next.destinationMode = raw.destinationMode;
  if (typeof raw.customSource === "string" && raw.customSource.trim()) next.customSource = raw.customSource.trim();
  if (typeof raw.customPresetSource === "string" && raw.customPresetSource.trim()) {
    next.customPresetSource = raw.customPresetSource.trim();
  }
  if (Array.isArray(raw.recentCustomSources)) {
    next.recentCustomSources = [...new Set(raw.recentCustomSources)]
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim())
      .slice(0, 3);
  }
  if (Array.isArray(raw.platforms)) next.platforms = uniquePlatforms(raw.platforms.filter(isPlatform));
  if (Array.isArray(raw.selectedPresetNames)) {
    next.selectedPresetNames = [...new Set(raw.selectedPresetNames)].filter(
      (name): name is string => typeof name === "string",
    );
  }
  if (isPresetSourceMode(raw.presetSourceMode)) next.presetSourceMode = raw.presetSourceMode;
  if (typeof raw.backup === "boolean") next.backup = raw.backup;
  if (typeof raw.prune === "boolean") next.prune = raw.prune;
  if (typeof raw.rebuild === "boolean") next.rebuild = raw.rebuild;
  if (typeof raw.presetInstallExtensions === "boolean") {
    next.presetInstallExtensions = raw.presetInstallExtensions;
  }
  if (typeof raw.skipExternalSkills === "boolean") {
    next.skipExternalSkills = raw.skipExternalSkills;
  }

  return next;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
