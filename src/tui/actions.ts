import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { analyzePresets, analyzeProject, type Logger } from "../build.js";
import { initCmd } from "../commands/init.js";
import { formatDiagnostic } from "../diagnostics.js";
import { runPresetInstall } from "../install.js";
import { loadExtensions } from "../parsers/extensions.js";
import { ParseError } from "../parsers/index.js";
import { planSource, selectedPresets, type TuiAction, type TuiState } from "./state.js";

interface RuntimeDependencies {
  spawn: typeof spawn;
  createInterface: typeof createInterface;
  runPresetInstall: typeof runPresetInstall;
}

interface RunTuiActionOptions {
  readonly signal?: AbortSignal;
}

const defaultRuntimeDependencies: RuntimeDependencies = { spawn, createInterface, runPresetInstall };
let runtimeDependencies: RuntimeDependencies = { ...defaultRuntimeDependencies };

export async function runTuiAction(
  state: TuiState,
  action: Exclude<TuiAction, "init">,
  logger: Logger,
  options: RunTuiActionOptions = {},
): Promise<void> {
  const planned = planSource(state);
  const presets = selectedPresets(state);

  if (action === "validate" || action === "presetValidate") {
    logger.header(action === "presetValidate" ? "ULIS Preset Validate" : "ULIS Validate");
    if (action === "presetValidate") {
      const analysis = analyzePresets({ presets, logger });
      logger.success(
        `Validated ${analysis.project.agents.length} agents, ${analysis.project.skills.length} skills, ${
          Object.keys(analysis.project.mcp.servers).length
        } MCP servers`,
      );
      return;
    }

    logger.info(`Source: ${planned.sourceDir}`);
    if (presets.length > 0) logger.info(`Presets: ${presets.map((preset) => preset.name).join(", ")}`);
    const analysis = analyzeProject({ sourceDir: planned.sourceDir, presets, logger });
    let extensionsConfig: ReturnType<typeof loadExtensions>;
    try {
      extensionsConfig = loadExtensions(planned.sourceDir, { source: "base", sourceDir: planned.sourceDir });
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
    return;
  }

  if (action === "presetInstall") {
    throwIfAborted(options.signal, action);
    await runtimeDependencies.runPresetInstall({
      destBase: planned.destBase,
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
    return;
  }

  await runActionInChildProcess(
    state,
    action,
    logger,
    presets.map((preset) => preset.name),
    options.signal,
  );
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
): Promise<void> {
  const entryScript = process.argv[1];
  if (!entryScript) {
    throw new Error("Unable to resolve current CLI entry script.");
  }

  const args = [...process.execArgv, entryScript, action, "--source", planSource(state).sourceDir];
  args.push("--target", state.platforms.join(","));
  if (presetNames.length > 0) args.push("--preset", presetNames.join(","));

  if (action === "install") {
    args.push("--yes");
    if (planSource(state).globalInstall) args.push("--global");
    if (!state.rebuild) args.push("--skip-rebuild");
    if (state.backup) args.push("--backup");
    if (!state.prune) args.push("--no-prune");
    if (state.skipExternalSkills) args.push("--skip-external-skills");
  }

  await new Promise<void>((resolve, reject) => {
    const child = runtimeDependencies.spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ULIS_NON_INTERACTIVE: "1" },
    });
    const abort = () => {
      child.kill();
      reject(new Error(`${action} stopped by user.`));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
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
      stdout.close();
      stderr.close();
      if (code === 0) resolve();
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
