# Code Splitting Review

Reviewed 2026-08-22 on `develop` (at `dd0c5cf`). Read-only survey: no code was
changed. Sizes below are line counts at the time of review.

| File                         | Lines |
| ---------------------------- | ----: |
| `src/install.test.ts`        |  4291 |
| `src/tui/controller.test.ts` |  1804 |
| `src/tui/state.ts`           |  1289 |
| `src/tui/state.test.ts`      |  1212 |
| `src/install.ts`             |  1147 |
| `src/tui/app.ts`             |   840 |
| `src/tui/view.ts`            |   681 |
| `src/tui/controller.ts`      |   595 |
| `src/utils/config-merger.ts` |   568 |

Splitting is cheap here: `tsup` bundles both entrypoints with
`splitting: false`, so module count has no effect on `dist/` or on the CI bundle
invariant that keeps OpenTUI out of `dist/cli.js`. The only real constraint is
the mock seam described under `install.ts`.

## 1. `src/utils/config-merger.ts` (568) — do this first

Two unrelated concerns sharing a file, no shared state, cleanest cut in the
repo.

| New file                                 | Moves                                                                                                                                                                                                                                                     | ~lines |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: |
| `utils/config-merge.ts`                  | `mergeConfigValues`, TOML overlay (`patchTomlOverlay`, `removeConflictingTomlRepresentations`, `tomlLineOffsets`, `seedMissingTomlTables`, `tomlTableHeaders`), `readMergeableConfig`/`writeMergeableConfig`, `mergeOrCopyFile`/`mergeOrCopyDir` (18-215) |    200 |
| `utils/config-paths.ts`                  | `ConfigPath`, `pickConfigPaths`, `omitConfigPaths`, `get`/`set`/`deleteConfigPath` (216, 462-525)                                                                                                                                                         |     80 |
| `utils/preserved-native-configs.ts`      | spec types, `PreservedNativeConfigParseError`, capture/write/entries (218-283, 389-461, 526-566)                                                                                                                                                          |    180 |
| `utils/preserved-native-configs.data.ts` | the `PRESERVED_NATIVE_CONFIGS` table (284-388)                                                                                                                                                                                                            |    105 |

The data table is worth its own file: it is a per-platform registry that grows
every time a platform is added, so the `add-platform` skill then points at one
obvious place. Keep `config-merger.ts` as a re-export shim for one release if
touching every import site at once is unwelcome.

## 2. `src/install.ts` (1147)

`src/install/` already exists (`errors`, `fs`, `layouts`, `manifest`,
`platforms`, `preview`, `types`), so the destinations are obvious. Residual
`install.ts` becomes just `runInstall` + `runPresetInstall` +
`installGeneratedOutput`, roughly 400 lines of orchestration.

- **`install/runtime.ts` — extract this first.** `RuntimeDependencies`
  (138-197), the `runtimeDependencies` mutable singleton, and the `__test` seam
  (1140-1147). Every other extracted module reads it, so it must live in exactly
  one module or the mock stops applying. Re-export `__test` from `install.ts` so
  `install.test.ts` does not churn.
- `install/trust-gate.ts` — `RemoteCommandPlan`, `planRemoteCommands`,
  `renderCommandPlan`, `confirmRemoteCommands`, `commandsMatch` (718-850, ~135).
  Security boundary with its own 675-line test block already; deserves a named
  module rather than mid-file placement. `confirmRemoteCommands` currently takes
  the whole `GeneratedInstallOptions` — narrow it to the ~6 fields it uses as
  part of the move.
- `install/runner.ts` — `resolveRunner`, `commandExists`, `resolveExecutable`,
  `formatCommandFailure`, `makeTimestamp`, `runCommand`, `runSkillCommand`,
  `runAsyncCommand`, `throwIfAborted` (1003-1116, ~115). Pure process plumbing,
  no install knowledge.
- `install/post-install.ts` — skills/extensions execution:
  `SKILL_PLATFORM_AGENT_NAMES`, `normalizeSkillArgs`, `skillAgentNames`,
  `skillNpxArgs`, `extensionRunnerArgs` (660-717) plus `installSkills`,
  `runBounded`, `runPlatformExtensions`, `installExtensions` (851-1002). ~290
  lines, the single biggest coherent chunk. `runBounded` is a generic
  concurrency helper — `utils/` is arguably its home.
- `install/dotenv.ts` — `UNTRUSTED_ENV_DENYLIST` + `loadDotEnv` (198-255, ~60).
  Self-contained, separately tested.
- `install/types.ts` (existing) — move `InstallOptions`, `PresetInstallOptions`,
  `GeneratedInstallOptions`, `AsyncCommandResult`, `SkillInstallLog` (27-137).

The sanitizing log helpers (1123-1139) must move to `install/log.ts` since the
split modules all need them — and the comment at 1117 explaining _why_
sanitization happens at the sink should move with them, not stay behind.

## 3. `src/tui/state.ts` (1289)

Three distinct layers in one module: data model, selectors/formatters,
key-dispatch state machine.

- `tui/state-model.ts` — screen/flow/action types, `TuiState`, `PlanItem`,
  `TuiEffect`, `DASHBOARD_ITEMS`/`FLOW_ITEMS`, `createInitialState` (12-234).
  ~220
- `tui/selectors.ts` — `planSource`, `selectedPresets`, `remotePresetRef`,
  `reviewFingerprint`, `hasPresetSelection`, all `format*`, `isEditedPlan`,
  platform/preset toggles, preset-choice filtering/sorting, `planItems`
  (235-496). ~260, all pure — the highest-value testable seam.
- `tui/flow-preferences.ts` — `flowPreferencesFromState`,
  `storeCurrentFlowPreferences`, `applyFlowPreferences` (497-584). ~90. Distinct
  from the existing `preferences.ts` (disk persistence); either name them
  clearly or fold this in as the in-memory half.
- `tui/keys.ts` — `handleTuiKey` and every per-screen `handle*Key`, plus
  `navigateBack`/`leaveReview`/`startOrMissingSource` (594-1193). ~600. Still
  the largest file after the split; if that is too big, cut again along the
  review screens (`handleInstallReviewKey`, `handlePresetInstallReviewKey`,
  `openPresetInstallReview`, `clearRemoteReview`, 1041-1156) into
  `tui/keys-review.ts`.
- `tui/key-codes.ts` — `normalizeKey`, `isUpKey`/`isDownKey`/`isConfirmKey`/
  `isToggleKey`/`isPasteKey`, `getNavigationDirection`, `isDuplicateKeyEvent`,
  `keyEventId`, `textInputValue`, `KEY_DUPLICATE_WINDOW_MS` (1194-1289). ~95.

## 4. `src/tui/app.ts` (840)

The `TuiApp` class mixes three jobs. Two come out as non-class modules.

- `tui/key-event.ts` — `keyEventToKey` (810-840). Pure `KeyEvent` to `string`;
  the only OpenTUI-typed thing in it. Natural pair with `key-codes.ts`.
- `tui/consent-gate.ts` — `isReviewStart`, `hasRemoteReviewConsent`,
  `currentConsentSignature`, `blockReviewStart`,
  `scrollToFirstUnseenConsentRow`, `rowIsFullyVisible`,
  `markVisibleConsentRows`, `consentRowWasSeen`, `allConsentCommandsSeen`,
  `reviewStartCanProceed`, plus the `consentSeenUntil`/`consentSignature`/
  `consentRestoredAt`/`consentPaintedAfterRestore`/`consentGateNotice` fields
  (90-94, 420-519). ~110. This is the "did the user actually scroll past every
  remote command" enforcement, currently reachable only through a rendered TUI.
  As its own class taking a scroll-geometry interface it becomes directly
  unit-testable.
- `tui/renderables.ts` — `createPane`, `estimatedPaneLines`, `fillPane`,
  `rowId`, `createRow`, `createOptionRow` (591-804). ~215. `ViewRow` plus theme
  to `Renderable`, no app state.

Residual `TuiApp`: lifecycle, input wiring, `syncInput`/`syncPanes`, ~300 lines.

## 5. `src/tui/view.ts` (681)

Split into a `tui/view/` directory.

- `view/types.ts` — `Tone`, `ViewTag`, `ViewRow`, `ViewPane`, `ViewInput`,
  `ScreenView`, `MIN_COLUMNS`/`MIN_ROWS`/`SPLIT_COLUMNS`, control-hint constants
  (24-94)
- `view/primitives.ts` — `pane`, `field`, `option`, `notice`, `onOff`,
  `displayWidth`, `middleElide`, `takeColumns`, `formatPlatforms`,
  `formatInstallCommand`, `quoteCommandArg`, `splitLogTag` (608-681, 478-503).
  ~150
- `view/screens-plan.ts` — `flowView`, `planView`, `planItemValue`, `sourceView`,
  `customSourceView`, `customPresetSourceView` (125-290)
- `view/screens-select.ts` — `presetsView`, `presetSourceHeading`,
  `platformsView`, `missingSourceView` (291-427)
- `view/screens-review.ts` — `remoteCommandRows`, `remoteWarningRows`,
  `formatRemoteSource`, `installReviewView`, `presetInstallReviewView`
  (428-575). ~150
- `view/index.ts` — `buildScreenView` dispatch plus `runningView`/`resultView`/
  `logRows`

## 6. `src/tui/controller.ts` (595)

Smaller payoff, but one clean seam: `tui/remote-review.ts` for
`prepareRemoteInstall`, `snapshotPrepareInputs`, `publishReview`,
`disposePreparedRemote`, `PreparedReview`, `PrepareSnapshot`,
`prepareGeneration` (71-91, 355-520, ~180). A self-contained async
prepare/invalidate state machine and the trickiest part of the file.
`formatActionTitle` (589) belongs next to the action types in `state-model.ts`.

## 7. Test files

`src/install.test.ts` at 4291 lines is the worst offender and splits
mechanically along its own `describe` boundaries, mirroring the `install.ts`
split: `install.dotenv.test.ts` (74-113), `install.trust-gate.test.ts`
(2740-3415), `install.provenance.test.ts` (3416-3983),
`install.preset.test.ts` (3984-4275), `install.runner.test.ts` (4276+),
`install.env.test.ts` (2678-2739). The `runInstall` describe alone is still
~2560 lines and needs a second pass along its nested describes.

The shared harness (`createTempRoot`, `write`/`read`, `waitFor`,
`silentLogger`, `createForgecodeOutput`, the `afterEach` cleanup, lines 28-73)
has to move to `src/test-utils/` first — that directory already exists. The
`afterEach` also calls `__test.resetRuntimeDependencies()`, so each split file
must keep that reset; it is the thing most likely to be dropped in the move.

Same pattern for `src/tui/controller.test.ts` (1804, 7 describes) and
`src/tui/state.test.ts` (1212, 4 describes).

## Suggested order

1. `config-merger.ts` — no shared mutable state, lowest risk, immediate win.
2. `install/runtime.ts` extraction, then the rest of `install.ts`. Do runtime
   first or the mocks silently stop working.
3. `state.ts` into model/selectors/keys.
4. `view.ts` into `view/`, then `app.ts` (renderables depend on view types).
5. Test-file splits, after `src/test-utils/` holds the shared harness.

## Caveat

Several of these files are large because they carry long explanatory comments
about security invariants: the log-sink sanitization note, the rebuild-forcing
rationale in `runInstall`, the TTY comment in `defaultRuntimeDependencies`.
Those comments are load-bearing, and moving code out from under them is the main
way this refactor could do damage. Each extraction should carry its comment
with it.
