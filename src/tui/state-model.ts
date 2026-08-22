/**
 * The TUI data model: screen/flow/action types, {@link TuiState} itself, plan-item data,
 * {@link createInitialState}, and {@link formatActionTitle} (kept beside the action types it
 * formats, per the code-splitting plan). {@link createInitialState} resets key-dispatch
 * duplicate-key tracking via `./key-codes.js` so a fresh state never inherits a stale window;
 * everything else here is inert data with no key handling or selection logic of its own.
 */
import { PLATFORMS, type Platform } from "../platforms.js";
import type { PresetListEntry } from "../presets.js";
import type { ResolvedPreset } from "../utils/resolve-presets.js";
import { resetDuplicateKeyTracking } from "./key-codes.js";

export type TuiScreen =
  | "flow"
  | "plan"
  | "source"
  | "customSource"
  | "customPresetSource"
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
export type PresetSourceMode = "auto" | "project" | "global" | "bundled" | "custom";
export type TuiPreferenceScope = TuiFlow;

export interface PlannedSource {
  readonly sourceDir: string;
  readonly destBase: string;
  readonly sourceMode: SourceMode;
  readonly destinationMode: DestinationMode;
  readonly sourceExists: boolean;
  readonly globalInstall?: boolean;
  /** True when `sourceDir` is a git URL to clone rather than a path on disk. */
  readonly remote: boolean;
}

export interface TuiFlowPreferences {
  readonly destinationMode?: DestinationMode;
  readonly customSource?: string;
  readonly customPresetSource?: string;
  readonly recentCustomSources?: readonly string[];
  readonly platforms?: readonly Platform[];
  readonly selectedPresetNames?: readonly string[];
  readonly presetSourceMode?: PresetSourceMode;
  readonly backup?: boolean;
  readonly prune?: boolean;
  readonly rebuild?: boolean;
  readonly presetInstallExtensions?: boolean;
  readonly skipExternalSkills?: boolean;
}

export interface TuiState {
  screen: TuiScreen;
  cursor: number;
  runningSpinnerFrame: number;
  flow: TuiFlow;
  sourceMode: SourceMode;
  destinationMode: DestinationMode;
  customSource: string;
  customPresetSource: string;
  /** Commands a remote source will execute, shown on the review screen as the consent boundary. */
  remoteCommands: readonly string[];
  /** Redacted URL the remoteCommands came from. Empty when the run is purely local. */
  remoteCommandSource: string;
  recentCustomSources: string[];
  textInput: string;
  platforms: Platform[];
  availablePresets: readonly PresetListEntry[];
  selectedPresetNames: string[];
  presetSourceMode: PresetSourceMode;
  backup: boolean;
  prune: boolean;
  rebuild: boolean;
  presetInstallExtensions: boolean;
  skipExternalSkills: boolean;
  flowPreferences: Partial<Record<TuiPreferenceScope, TuiFlowPreferences>>;
  logs: string[];
  notice: string;
  resultTitle: string;
  resultMessage: string;
  pendingAction?: Exclude<TuiAction, "init">;
}

/**
 * Row of "Start preset install" on the preset install review screen. Entering the screen lands
 * here rather than on the first toggle, so a confirming Enter never flips an option instead.
 */
export const PRESET_INSTALL_REVIEW_START_ROW = 3;

/** Last row of the preset install review screen ("Back to presets"), and so the cursor's bound. */
export const PRESET_INSTALL_REVIEW_BACK_ROW = PRESET_INSTALL_REVIEW_START_ROW + 1;

/**
 * A clone made for the review screen and reused by the install that follows, so the commands the
 * user consented to are the commands that run.
 */
export interface PreparedRemoteInstall {
  /** The action this review was generated for; it may not be consumed by any other. */
  readonly action: "install" | "presetInstall";
  /** {@link reviewFingerprint} of the settings the commands were displayed for. */
  readonly fingerprint: string;
  /** Local path of the cloned base source, when the source itself was remote. */
  readonly sourceDir?: string;
  /**
   * The exact command list the review screen displayed. Handed to the installer, which re-plans
   * from the real install options and refuses to run anything that does not match.
   */
  readonly commands: readonly string[];
  readonly presets: readonly ResolvedPreset[];
  readonly cleanup: () => void;
}

export type TuiEffect = { readonly discardRemoteReview?: true } & (
  | { readonly type: "none" }
  | { readonly type: "exit"; readonly code: number }
  | { readonly type: "cancelRunning" }
  | { readonly type: "start"; readonly action: Exclude<TuiAction, "init"> }
  | { readonly type: "initSource" }
  | { readonly type: "loadCustomPresetSource"; readonly path: string }
  | { readonly type: "pasteClipboard" }
  | { readonly type: "prepareRemoteInstall"; readonly action: "install" | "presetInstall" }
);

export type PlanItemId =
  | "presets"
  | "source"
  | "platforms"
  | "destination"
  | "presetExtensions"
  | "skipExternalSkills"
  | "prune"
  | "rebuild"
  | "backup"
  | "validate"
  | "build"
  | "install"
  | "back";

export interface PlanItem {
  readonly id: PlanItemId;
  readonly label: string;
  /** Render a blank row after this item. Replaces the positional BREAKS arrays. */
  readonly breakAfter?: true;
}

/** Forces exhaustive handling of {@link PlanItemId}: a new id that nobody handled fails the build. */
export function assertNeverPlanItemId(id: never): never {
  throw new Error(`Unhandled plan item id: ${id as string}`);
}

export const DASHBOARD_ITEMS: readonly PlanItem[] = [
  { id: "presets", label: "Preset layers" },
  { id: "source", label: "Base source" },
  { id: "platforms", label: "Platforms" },
  { id: "destination", label: "Install destination", breakAfter: true },
  { id: "skipExternalSkills", label: "Skip external skills" },
  { id: "prune", label: "Prune removed agents and skills" },
  { id: "rebuild", label: "Use latest build output" },
  { id: "backup", label: "Backup", breakAfter: true },
  { id: "validate", label: "Validate" },
  { id: "build", label: "Build only" },
  { id: "install", label: "Install", breakAfter: true },
  { id: "back", label: "Back to start" },
];

export const PRESET_ONLY_PLAN_ITEMS: readonly PlanItem[] = [
  { id: "presets", label: "Preset sources" },
  { id: "platforms", label: "Platforms" },
  { id: "destination", label: "Install destination", breakAfter: true },
  { id: "presetExtensions", label: "Run preset extensions" },
  { id: "skipExternalSkills", label: "Skip external skills" },
  { id: "prune", label: "Prune removed agents and skills" },
  { id: "backup", label: "Backup", breakAfter: true },
  { id: "validate", label: "Validate" },
  { id: "install", label: "Install", breakAfter: true },
  { id: "back", label: "Back to start" },
];

export const FLOW_ITEMS = [
  "Update this project",
  "Update global configs",
  "Use custom source",
  "Install presets only",
  "Quit",
] as const;

export function createInitialState(availablePresets: readonly PresetListEntry[] = []): TuiState {
  resetDuplicateKeyTracking();
  return {
    screen: "flow",
    cursor: 0,
    runningSpinnerFrame: 0,
    flow: "project",
    sourceMode: "project",
    destinationMode: "project",
    customSource: "",
    customPresetSource: "",
    remoteCommands: [],
    remoteCommandSource: "",
    recentCustomSources: [],
    textInput: "",
    platforms: [...PLATFORMS],
    availablePresets,
    selectedPresetNames: [],
    presetSourceMode: "auto",
    backup: true,
    prune: true,
    rebuild: true,
    presetInstallExtensions: true,
    skipExternalSkills: false,
    flowPreferences: {},
    logs: [],
    notice: "",
    resultTitle: "",
    resultMessage: "",
  };
}

type ActionTitleKey = Exclude<TuiEffect & { type: "start" }, never>["action"];

export function formatActionTitle(action: ActionTitleKey): string {
  if (action === "validate") return "Validate";
  if (action === "presetValidate") return "Preset Validate";
  if (action === "build") return "Build";
  if (action === "presetInstall") return "Preset Install";
  return "Install";
}
