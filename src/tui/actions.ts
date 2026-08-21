import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { analyzePresets, analyzeProject, type Logger } from "../build.js";
import { initCmd } from "../commands/init.js";
import { formatDiagnostic } from "../diagnostics.js";
import { runInstall, runPresetInstall } from "../install.js";
import { loadExtensions } from "../parsers/extensions.js";
import { ParseError } from "../parsers/index.js";
import { redactUserinfo } from "../utils/redact.js";
import { resolvePresets, type ResolvedPreset } from "../utils/resolve-presets.js";
import { resolveSourceOrRemote } from "../utils/resolve-source.js";
import { ULIS_CLI_ENTRY_ENV } from "./launcher.js";
import {
  planSource,
  remotePresetRef,
  reviewFingerprint,
  selectedPresets,
  type PreparedRemoteInstall,
  type TuiAction,
  type TuiState,
} from "./state.js";

interface RuntimeDependencies {
  spawn: typeof spawn;
  createInterface: typeof createInterface;
  runPresetInstall: typeof runPresetInstall;
  runInstall: typeof runInstall;
}

export interface RunTuiActionOptions {
  readonly signal?: AbortSignal;
  /** Clone already made for the review screen; reused so consent matches what runs. */
  readonly prepared?: PreparedRemoteInstall;
  /** Working directory used for plan resolution; must match the one used at review time. */
  readonly cwd?: string;
  /** Home directory override used with cwd in tests. */
  readonly userHome?: string;
}

/**
 * The trust invariant, enforced at the execution sink rather than at the screen: no remote command
 * runs unless a review that displayed exactly those commands, for exactly these settings, is still
 * valid. Any drift since the review - options toggled, platforms changed, a different source -
 * invalidates it, and the run is refused rather than silently executing unreviewed commands.
 */
function requireReviewedRemote(
  state: TuiState,
  action: "install" | "presetInstall",
  options: RunTuiActionOptions,
): void {
  const prepared = options.prepared;
  if (!prepared) {
    throw new Error("A remote source must be confirmed on the review screen before installing.");
  }
  if (prepared.action !== action) {
    throw new Error("A remote review may only start the action it was generated for.");
  }
  if (prepared.fingerprint !== reviewFingerprint(state, action, options.cwd, options.userHome)) {
    throw new Error("Settings changed since the remote commands were reviewed. Review them again before installing.");
  }
}

/** How long to let a cancelled child clean up after SIGINT before terminating it outright. */
const CHILD_CANCEL_GRACE_MS = 5_000;

const defaultRuntimeDependencies: RuntimeDependencies = { spawn, createInterface, runPresetInstall, runInstall };
let runtimeDependencies: RuntimeDependencies = { ...defaultRuntimeDependencies };

export async function runTuiAction(
  state: TuiState,
  action: Exclude<TuiAction, "init">,
  logger: Logger,
  options: RunTuiActionOptions = {},
): Promise<void> {
  // Same cwd the review screen planned with. Without it an injected cwd would show one destination
  // and install to another, and the fingerprint below would still match.
  const planned = planSource(state, options.cwd, options.userHome);
  const localPresets = selectedPresets(state);
  const remoteRef = remotePresetRef(state);

  if (action === "validate" || action === "presetValidate") {
    logger.header(action === "presetValidate" ? "ULIS Preset Validate" : "ULIS Validate");

    if (action === "presetValidate") {
      const { presets, cleanup } = remoteRef
        ? await resolveRemotePresets(remoteRef, localPresets, logger, options.signal)
        : localPresetSelection(localPresets);
      try {
        const analysis = analyzePresets({ presets, logger });
        logger.success(
          `Validated ${analysis.project.agents.length} agents, ${analysis.project.skills.length} skills, ${
            Object.keys(analysis.project.mcp.servers).length
          } MCP servers`,
        );
      } finally {
        cleanup();
      }
      return;
    }

    // Validation writes nothing, so a remote source is fine here: clone it, read it, discard it.
    const resolvedSource = planned.remote
      ? await resolveSourceOrRemote({
          source: planned.sourceDir,
          global: planned.globalInstall,
          logger,
          signal: options.signal,
        })
      : undefined;

    // From here the base clone exists, so every later failure - including one while resolving the
    // preset ref - must reach a cleanup. Resolving presets inside the try is what guarantees that.
    let cleanup: () => void = () => {};
    try {
      const sourceDir = resolvedSource?.sourceDir ?? planned.sourceDir;
      const selection = remoteRef
        ? await resolveRemotePresets(remoteRef, localPresets, logger, options.signal)
        : localPresetSelection(localPresets);
      const presets = selection.presets;
      cleanup = selection.cleanup;

      logger.info(`Source: ${redactUserinfo(planned.sourceDir)}`);
      if (presets.length > 0) logger.info(`Presets: ${presets.map((preset) => preset.name).join(", ")}`);
      const analysis = analyzeProject({ sourceDir, presets, logger });
      let extensionsConfig: ReturnType<typeof loadExtensions>;
      try {
        extensionsConfig = loadExtensions(sourceDir, { source: "base", sourceDir });
      } catch (err) {
        if (err instanceof ParseError) {
          logger.error(formatDiagnostic(err.toDiagnostic()));
          throw new Error("Parsing failed: 1 error(s). No files written.");
        }
        throw err;
      }
      const extensionCount = Object.values(extensionsConfig).reduce(
        (acc, entry) => acc + (entry?.extensions?.length ?? 0),
        0,
      );
      logger.success(
        `Validated ${analysis.project.agents.length} agents, ${analysis.project.skills.length} skills, ${
          Object.keys(analysis.project.mcp.servers).length
        } MCP servers, ${extensionCount} extensions`,
      );
    } finally {
      cleanup();
      resolvedSource?.cleanup();
    }
    return;
  }

  if (action === "presetInstall") {
    throwIfAborted(options.signal, action);
    if (remoteRef) requireReviewedRemote(state, action, options);
    const { presets, cleanup } = options.prepared
      ? // Already cloned for the review screen: reuse it, and let that screen be the consent.
        localPresetSelection(options.prepared.presets)
      : localPresetSelection(localPresets);
    throwIfAborted(options.signal, action);
    try {
      await runtimeDependencies.runPresetInstall({
        // Declared so the gate sees this run as remote. The TUI owns the terminal and cannot answer
        // a stdin prompt, so consent is the review screen — and the list it displayed goes down with
        // the run, for the installer to check against what it actually plans.
        remoteSources: remoteRef ? [remoteRef] : undefined,
        approvedCommands: options.prepared?.commands,
        destBase: planned.destBase,
        userHome: options.userHome,
        globalInstall: planned.globalInstall,
        platforms: state.platforms,
        backup: state.backup,
        prune: state.prune,
        logger,
        presets,
        installExtensions: state.presetInstallExtensions,
        installSkills: !state.skipExternalSkills,
        signal: options.signal,
      });
    } finally {
      cleanup();
    }
    return;
  }

  if (action === "build" && planned.remote) {
    // Never build a child command line out of a remote source: the URL carries any credentials the
    // user pasted, and `ulis build` rejects a remote source anyway.
    throw new Error(
      "Build writes generated output into the source tree, so it cannot run against a remote source. Use Install instead.",
    );
  }

  if (action === "install" && (planned.remote || remoteRef)) {
    // Nothing downstream can gate this, so it is the last point an unreviewed remote install stops.
    // `remoteRef` is presets-only and so cannot be set for `install` today; it stays because
    // dropping it would let a future presets-only install fall through to the child process, which
    // silently ignores a remote ref rather than refusing it.
    requireReviewedRemote(state, action, options);
    const prepared = options.prepared!;

    // Run in-process rather than through the CLI: handing the child the clone as `--source` would
    // make it derive destBase from the clone's parent, writing the install next to the temp dir
    // (and deleting it with the clone). In-process keeps the reviewed destination explicit.
    // Same expression as `controller.ts`'s `remoteCommandSource`: when only the preset ref is
    // remote (`planned.remote` false), the base source is not what the trust gate should attribute
    // this to - `planned.sourceDir` would be a local path there, not the remote source in play.
    const label = redactUserinfo(planned.remote ? planned.sourceDir : (remoteRef ?? ""));
    await runtimeDependencies.runInstall({
      sourceDir: prepared.sourceDir ?? planned.sourceDir,
      sourceLabel: label,
      // Not `true`: this branch also fires for a presets-only `remoteRef` over a local base source
      // (`planned.remote` false, `remoteRef` set), and `true` there would wrongly drop that local
      // source's `.env` too - only `planned.remote` says whether the base source itself is a clone.
      sourceIsRemote: planned.remote,
      destBase: planned.destBase,
      userHome: options.userHome,
      globalInstall: planned.globalInstall,
      platforms: state.platforms,
      backup: state.backup,
      prune: state.prune,
      rebuild: state.rebuild,
      logger,
      presets: prepared.presets,
      installExtensions: true,
      installSkills: !state.skipExternalSkills,
      // Consent was the review screen; the installer re-plans and refuses anything that differs
      // from the list it displayed.
      remoteSources: [label],
      approvedCommands: prepared.commands,
      signal: options.signal,
    });
    return;
  }

  await runActionInChildProcess(
    state,
    action,
    logger,
    localPresets.map((preset) => preset.name),
    options.signal,
    options.cwd,
    options.userHome,
  );
}

/**
 * Clone a remote preset ref, if there is one, and append it to the locally selected presets.
 * Uses the same resolver as the CLI; the caller owns `cleanup`.
 */
async function resolveRemotePresets(
  remoteRef: string,
  localPresets: readonly ResolvedPreset[],
  logger: Logger,
  signal: AbortSignal | undefined,
): Promise<PresetSelection> {
  const { presets, cleanup } = await resolvePresets([remoteRef], { nonInteractive: true, logger, signal });
  return { presets: [...localPresets, ...presets], cleanup };
}

interface PresetSelection {
  readonly presets: readonly ResolvedPreset[];
  readonly cleanup: () => void;
}

/**
 * Never `await` when there is nothing remote to fetch: an extra microtask would let an abort that
 * arrives in the same tick land before the installer has registered its abort listener.
 */
function localPresetSelection(presets: readonly ResolvedPreset[]): PresetSelection {
  return { presets, cleanup: () => {} };
}

export async function initializeMissingSource(state: TuiState, logger: Logger): Promise<void> {
  if (state.sourceMode === "custom") {
    throw new Error("Custom sources cannot be initialized from the TUI.");
  }

  logger.header("ULIS Init");
  await initCmd({ global: state.sourceMode === "global", logger });
}

async function runActionInChildProcess(
  state: TuiState,
  action: Exclude<TuiAction, "init" | "validate" | "presetValidate" | "presetInstall">,
  logger: Logger,
  presetNames: readonly string[],
  signal?: AbortSignal,
  cwd?: string,
  userHome?: string,
): Promise<void> {
  const entryScript = process.env[ULIS_CLI_ENTRY_ENV] || process.argv[1];
  if (!entryScript) {
    throw new Error("Unable to resolve current CLI entry script.");
  }

  // Same cwd the plan was resolved with, or the child would install somewhere the plan never showed.
  const planned = planSource(state, cwd, userHome);
  const args = [...process.execArgv, entryScript, action, "--source", planned.sourceDir];
  args.push("--target", state.platforms.join(","));
  if (presetNames.length > 0) args.push("--preset", presetNames.join(","));

  if (action === "install") {
    args.push("--yes");
    if (planned.globalInstall) args.push("--global");
    if (!state.rebuild) args.push("--skip-rebuild");
    if (state.backup) args.push("--backup");
    if (!state.prune) args.push("--no-prune");
    if (state.skipExternalSkills) args.push("--skip-external-skills");
  }

  await new Promise<void>((resolve, reject) => {
    const stopped = () => new Error(`${action} stopped by user.`);
    // Already cancelled: settle now. Spawning would arm the grace timer with no `close` handler to
    // clear it, stalling the run for the full grace period on a child nobody is reading from.
    if (signal?.aborted) {
      reject(stopped());
      return;
    }

    const child = runtimeDependencies.spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ULIS_NON_INTERACTIVE: "1" },
    });
    let cancelling = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      if (cancelling) return;
      cancelling = true;
      // SIGINT, not a plain kill: the CLI removes its clones on SIGINT, and terminating outright
      // would skip that and strand every temp directory the child created.
      child.kill("SIGINT");
      graceTimer = setTimeout(() => {
        graceTimer = undefined;
        child.kill();
        reject(stopped());
      }, CHILD_CANCEL_GRACE_MS);
      graceTimer.unref?.();
    };
    signal?.addEventListener("abort", abort, { once: true });

    const stdout = runtimeDependencies.createInterface({ input: child.stdout });
    stdout.on("line", (line) => {
      forwardChildLogLine(logger, line, "info");
    });

    const stderr = runtimeDependencies.createInterface({ input: child.stderr });
    stderr.on("line", (line) => {
      forwardChildLogLine(logger, line, "warn");
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (graceTimer) clearTimeout(graceTimer);
      stdout.close();
      stderr.close();
      if (cancelling) reject(stopped());
      else if (code === 0) resolve();
      else reject(new Error(`${action} exited with code ${code ?? "unknown"}`));
    });
  });
}

function throwIfAborted(signal: AbortSignal | undefined, action: Exclude<TuiAction, "init">): void {
  if (signal?.aborted) throw new Error(`${action} stopped by user.`);
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/gu, "");
}

function forwardChildLogLine(logger: Logger, line: string, fallback: "info" | "warn"): void {
  const text = stripAnsi(line).trim();
  if (text.length === 0) return;

  const match = text.match(/^\[(info|done|warn|error)\]\s*(.*)$/u);
  const level = match?.[1] ?? fallback;
  const message = match?.[2] ?? text;
  if (level === "done") logger.success(message);
  else if (level === "warn") logger.warn(message);
  else if (level === "error") logger.error(message);
  else logger.info(message);
}

export const __test = {
  setRuntimeDependencies(overrides: Partial<RuntimeDependencies>): void {
    runtimeDependencies = { ...runtimeDependencies, ...overrides };
  },
  resetRuntimeDependencies(): void {
    runtimeDependencies = { ...defaultRuntimeDependencies };
  },
};
