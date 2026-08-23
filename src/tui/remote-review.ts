/**
 * The install-review clone-and-plan state machine: fetching the remote source and/or preset ref
 * for the review screens, planning the command list from that clone, and invalidating a prepared
 * review when it is superseded, cancelled, or consumed. This is the only file that fetches on the
 * *review* path (before the user has consented to anything) and the only one that owns
 * `prepareGeneration` (the counter that lets a superseded preparation discard its own
 * late-arriving result). `actions.ts` also fetches a remote source (inline) or preset ref (via its
 * `resolveRemotePresets`), but only on the *run* path - used when `runTuiAction` finds no prepared
 * review to reuse (no review was ever shown, e.g. a non-interactive run).
 *
 * This module does not own the prepared clone or the generation counter itself - `controller.ts`
 * does, so `controller.test.ts` can keep reflecting directly into `TuiController#preparedRemote`.
 * It reaches that state, the renderer, the logger, and the shutdown cleanup registry only through
 * {@link RemoteReviewHost}, which `controller.ts` implements. The dependency runs one way: this
 * module never imports from `controller.ts`.
 */
import type { Logger } from "../build.js";
import { planRemoteCommands } from "../install/trust-gate.js";
import type { Platform } from "../platforms.js";
import { sanitizeConsentText } from "../utils/redact.js";
import { resolvePresets, type ResolvedPreset } from "../utils/resolve-presets.js";
import { resolveSourceOrRemote } from "../utils/resolve-source.js";
import { planSource, remotePresetRef, reviewFingerprint, selectedPresets } from "./selectors.js";
import {
  PRESET_INSTALL_REVIEW_START_ROW,
  type PlannedSource,
  type PreparedRemoteInstall,
  type TuiScreen,
  type TuiState,
} from "./state-model.js";

/**
 * A prepared review plus the bookkeeping only the controller needs: what was fetched, so a review
 * regenerated for the same remote can reuse the clone instead of going back to the network.
 */
export interface PreparedReview extends PreparedRemoteInstall {
  /** Identity of the fetch itself. Options change the command list, not the tree it is read from. */
  readonly cloneKey: string;
  readonly remotePresets: readonly ResolvedPreset[];
}

/** Everything the command list is planned from, captured at the same instant as the fingerprint. */
interface PrepareSnapshot {
  readonly fingerprint: string;
  readonly platforms: readonly Platform[];
  readonly presetInstallExtensions: boolean;
  readonly skipExternalSkills: boolean;
  readonly localPresets: readonly ResolvedPreset[];
}

/**
 * What `controller.ts` exposes so this module can prepare and dispose reviews without owning the
 * controller's state itself. `preparedRemote`/`prepareGeneration`/`prepareAbort` are get/set pairs
 * backed by the controller's own private fields, so a write here is a write there. Never spread a
 * `RemoteReviewHost` (`{ ...host }`) - that reads each accessor once into a plain value and hands
 * back an object that looks the same but has silently stopped writing through, reintroducing the
 * tearing this design exists to avoid.
 */
export interface RemoteReviewHost {
  readonly state: TuiState;
  readonly cwd?: string;
  readonly userHome?: string;
  preparedRemote: PreparedReview | undefined;
  prepareGeneration: number;
  prepareAbort: AbortController | undefined;
  render(): void;
  createLogger(): Logger;
  startSpinner(): void;
  clearSpinner(): void;
  /** Registers a cleanup so shutdown can reach an in-flight clone that outlives its own await. */
  trackCleanup(cleanup: () => void): void;
  untrackCleanup(cleanup: () => void): void;
}

function snapshotPrepareInputs(host: RemoteReviewHost, action: "install" | "presetInstall"): PrepareSnapshot {
  return {
    fingerprint: reviewFingerprint(host.state, action, host.cwd, host.userHome),
    platforms: [...host.state.platforms],
    presetInstallExtensions: host.state.presetInstallExtensions,
    skipExternalSkills: host.state.skipExternalSkills,
    localPresets: selectedPresets(host.state),
  };
}

/** Plan the command list from an already-resolved clone and show it on the review screen. */
function publishReview(
  host: RemoteReviewHost,
  action: "install" | "presetInstall",
  plan: PlannedSource,
  remoteRef: string | undefined,
  cloneKey: string,
  snapshot: PrepareSnapshot,
  clone: { sourceDir?: string; remotePresets: readonly ResolvedPreset[]; cleanup: () => void },
): void {
  const presets = [...snapshot.localPresets, ...clone.remotePresets];
  const commands = planRemoteCommands({
    sourceDir: action === "install" ? (clone.sourceDir ?? plan.sourceDir) : undefined,
    presets,
    platforms: snapshot.platforms,
    destBase: plan.destBase,
    userHome: host.userHome,
    globalInstall: plan.globalInstall,
    installExtensions: action === "presetInstall" ? snapshot.presetInstallExtensions : true,
    installSkills: !snapshot.skipExternalSkills,
  });

  host.preparedRemote = {
    action,
    fingerprint: snapshot.fingerprint,
    cloneKey,
    sourceDir: clone.sourceDir,
    remotePresets: clone.remotePresets,
    presets,
    commands,
    cleanup: clone.cleanup,
  };
  host.state.remoteCommands = commands;
  host.state.remoteCommandSource = sanitizeConsentText(plan.remote ? plan.sourceDir : (remoteRef ?? ""));

  const screen = action === "install" ? "installReview" : "presetInstallReview";
  if (host.state.screen !== screen) {
    host.state.screen = screen;
    // Land on "Start", never on a toggle: a confirming Enter must not flip an option instead.
    host.state.cursor = action === "install" ? 0 : PRESET_INSTALL_REVIEW_START_ROW;
  }
}

export function disposePreparedRemote(host: RemoteReviewHost): void {
  host.preparedRemote?.cleanup();
  host.preparedRemote = undefined;
  host.state.remoteCommands = [];
  host.state.remoteCommandSource = "";
}

/**
 * Clone the remote source (and/or preset ref) so the review screen can list the exact commands it
 * will run. The clone is kept and handed to the install, so consent applies to what executes.
 */
export async function prepareRemoteInstall(host: RemoteReviewHost, action: "install" | "presetInstall"): Promise<void> {
  const plan = planSource(host.state, host.cwd, host.userHome);
  const remoteRef = remotePresetRef(host.state);
  // `action` rides along even though `publishReview` replans for whichever action is asked for:
  // it costs one string and removes any need to reason about cross-action reuse at all.
  const cloneKey = JSON.stringify([action, plan.remote ? plan.sourceDir : "", remoteRef ?? "", plan.globalInstall]);

  // The review screen's own toggles are part of the fingerprint, so using them has to regenerate
  // the review. They change the command list, never the tree it is planned from, so replan from
  // the clone already on disk rather than putting a network round trip behind every checkbox.
  if (host.prepareAbort == null && host.preparedRemote?.cloneKey === cloneKey) {
    const reused = host.preparedRemote;
    publishReview(host, action, plan, remoteRef, cloneKey, snapshotPrepareInputs(host, action), {
      sourceDir: reused.sourceDir,
      remotePresets: reused.remotePresets,
      cleanup: reused.cleanup,
    });
    host.render();
    return;
  }

  // One preparation at a time: a second one must not overwrite the first's clone without
  // disposing it, and a completion that arrives after being superseded must throw its own away.
  host.prepareAbort?.abort();
  disposePreparedRemote(host);
  const generation = ++host.prepareGeneration;
  const abort = new AbortController();
  host.prepareAbort = abort;

  // Snapshot every input the command list depends on at the same instant as the fingerprint.
  // Reading them back after the awaits would let a change made during the clone (and reverted
  // afterwards) produce a review that omits commands the matching fingerprint then permits.
  const snapshot = snapshotPrepareInputs(host, action);
  const cleanups: (() => void)[] = [];
  const disposeAll = () => {
    while (cleanups.length > 0) cleanups.pop()!();
  };
  // Visible to shutdown, so an in-flight clone is never stranded on disk.
  host.trackCleanup(disposeAll);

  // Fetching is a network operation, so it gets the same running screen as every other long
  // operation: progress is visible, its logs stream, `q` cancels it, and - because that screen
  // takes no editing keys - the plan cannot drift out from under the review being prepared.
  const title = action === "install" ? "Fetch remote source" : "Fetch remote presets";
  // A superseded preparation inherits the running screen; the plan screen is the only way in.
  const originScreen: TuiScreen = host.state.screen === "running" ? "plan" : host.state.screen;
  host.state.notice = "";
  host.state.logs = [`Starting: ${title}`];
  host.state.screen = "running";
  host.state.runningSpinnerFrame = 0;
  host.startSpinner();
  host.render();

  try {
    const source = plan.remote
      ? await resolveSourceOrRemote({
          source: plan.sourceDir,
          global: plan.globalInstall,
          logger: host.createLogger(),
          signal: abort.signal,
        })
      : undefined;
    if (source) cleanups.push(source.cleanup);

    const remote = remoteRef
      ? await resolvePresets([remoteRef], {
          nonInteractive: true,
          logger: host.createLogger(),
          signal: abort.signal,
        })
      : undefined;
    if (remote) cleanups.push(remote.cleanup);

    if (generation !== host.prepareGeneration) {
      // Superseded while cloning: this result is stale, so discard it rather than publish it.
      disposeAll();
      return;
    }
    // Cancelled mid-clone: keep the result off the screen as well as off the disk.
    if (abort.signal.aborted) throw new Error(`${title} stopped by user.`);

    host.clearSpinner();
    publishReview(host, action, plan, remoteRef, cloneKey, snapshot, {
      sourceDir: source?.sourceDir,
      remotePresets: remote?.presets ?? [],
      cleanup: disposeAll,
    });
  } catch (error) {
    disposeAll();
    if (generation !== host.prepareGeneration) return;
    host.clearSpinner();
    // A failed clone is a notice, never a crash.
    host.state.screen = originScreen;
    host.state.notice = abort.signal.aborted
      ? `${title} stopped by user.`
      : error instanceof Error
        ? error.message
        : String(error);
    host.state.remoteCommands = [];
    host.state.remoteCommandSource = "";
  } finally {
    host.untrackCleanup(disposeAll);
    if (host.prepareAbort === abort) host.prepareAbort = undefined;
  }
  host.render();
}
