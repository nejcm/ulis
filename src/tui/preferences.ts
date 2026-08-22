import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { PLATFORMS, uniquePlatforms, type Platform } from "../platforms.js";
import { redactUserinfo } from "../utils/redact.js";
import { presetSourceKey, rememberCustomSource } from "./selectors.js";
import {
  type DestinationMode,
  type PresetSourceMode,
  type SourceMode,
  type TuiFlow,
  type TuiFlowPreferences,
  type TuiState,
} from "./state-model.js";

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

/**
 * In-memory half of flow preferences: reading the current session's settings into a
 * {@link TuiFlowPreferences} snapshot and applying a stored one back onto {@link TuiState}. The
 * disk-persistence half - load/save/parse against `.ulis-tui.json` - is the rest of this file.
 */
export function flowPreferencesFromState(state: TuiState): TuiFlowPreferences {
  const preferences: MutableFlowPreferences = {
    destinationMode: state.destinationMode,
    recentCustomSources: [...state.recentCustomSources],
    platforms: [...state.platforms],
    selectedPresetNames: [...state.selectedPresetNames],
    presetSourceMode: state.presetSourceMode,
    backup: state.backup,
    prune: state.prune,
    rebuild: state.rebuild,
    presetInstallExtensions: state.presetInstallExtensions,
    skipExternalSkills: state.skipExternalSkills,
  };

  // Redacted on the way to disk: preferences outlive the session, a credential should not.
  if (state.flow === "custom" && state.customSource) {
    preferences.customSource = redactUserinfo(state.customSource);
  }
  if (state.flow === "presetsOnly" && state.customPresetSource) {
    preferences.customPresetSource = redactUserinfo(state.customPresetSource);
  }

  return preferences;
}

export function storeCurrentFlowPreferences(state: TuiState): void {
  state.flowPreferences = {
    ...state.flowPreferences,
    [state.flow]: flowPreferencesFromState(state),
  };
}

export function applyFlowPreferences(
  state: TuiState,
  flow: TuiFlow = state.flow,
  customPresetSourceLoaded = false,
): void {
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
  if (flow === "presetsOnly" && preferences.customPresetSource) {
    state.customPresetSource = preferences.customPresetSource;
  }
  if (preferences.presetSourceMode) state.presetSourceMode = preferences.presetSourceMode;

  if (preferences.platforms) {
    const platforms = uniquePlatforms(preferences.platforms);
    state.platforms = platforms.length > 0 ? platforms : [...PLATFORMS];
  }
  if (preferences.selectedPresetNames) {
    const selectedPresetNames = [...new Set(preferences.selectedPresetNames)];
    const customSourcePending =
      flow === "presetsOnly" &&
      state.presetSourceMode === "custom" &&
      Boolean(state.customPresetSource) &&
      !customPresetSourceLoaded;
    if (customSourcePending) {
      state.selectedPresetNames = selectedPresetNames;
    } else {
      const availablePresetNames = new Set(
        state.availablePresets.flatMap((preset) => [preset.name, presetSourceKey(preset)]),
      );
      state.selectedPresetNames = selectedPresetNames.filter((name) => availablePresetNames.has(name));
    }
  }
  if (typeof preferences.backup === "boolean") state.backup = preferences.backup;
  if (typeof preferences.prune === "boolean") state.prune = preferences.prune;
  if (typeof preferences.rebuild === "boolean") state.rebuild = preferences.rebuild;
  if (typeof preferences.presetInstallExtensions === "boolean") {
    state.presetInstallExtensions = preferences.presetInstallExtensions;
  }
  if (typeof preferences.skipExternalSkills === "boolean") {
    state.skipExternalSkills = preferences.skipExternalSkills;
  }
}

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

export function applyTuiPreferences(state: TuiState, preferences: TuiPreferences): boolean {
  if (typeof preferences.version === "number" && preferences.version > TUI_PREFERENCES_VERSION) return false;

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
  return true;
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

export function loadTuiPreferences(
  state: TuiState,
  filePath: string = getTuiPreferencesPath(),
): { readonly canSave: boolean; readonly notice?: string } {
  if (!existsSync(filePath)) return { canSave: true };

  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    if (!isRecord(raw)) {
      return {
        canSave: true,
        notice: `Ignored TUI preferences at ${filePath} because the file is not a JSON object.`,
      };
    }
    if (!applyTuiPreferences(state, raw)) {
      return {
        canSave: false,
        notice: `TUI preferences at ${filePath} use version ${String(raw.version)}, which is newer than this ULIS understands. Your preferences will not be changed this session.`,
      };
    }
    return { canSave: true };
  } catch (error) {
    return {
      canSave: true,
      notice: `Unable to load TUI preferences from ${filePath}: ${formatError(error)}`,
    };
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
