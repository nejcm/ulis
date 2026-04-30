import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { analyzeProject, type Logger } from "../build.js";
import { initCmd } from "../commands/init.js";
import { planSource, selectedPresets, type TuiAction, type TuiState } from "./state.js";

interface RuntimeDependencies {
  spawn: typeof spawn;
  createInterface: typeof createInterface;
}

const defaultRuntimeDependencies: RuntimeDependencies = { spawn, createInterface };
let runtimeDependencies: RuntimeDependencies = { ...defaultRuntimeDependencies };

export async function runTuiAction(state: TuiState, action: Exclude<TuiAction, "init">, logger: Logger): Promise<void> {
  const planned = planSource(state);
  const presets = selectedPresets(state);

  if (action === "validate") {
    logger.header("ULIS Validate");
    logger.info(`Source: ${planned.sourceDir}`);
    if (presets.length > 0) logger.info(`Presets: ${presets.map((preset) => preset.name).join(", ")}`);
    const analysis = analyzeProject({ sourceDir: planned.sourceDir, presets, logger });
    logger.success(
      `Validated ${analysis.project.agents.length} agents, ${analysis.project.skills.length} skills, ${
        Object.keys(analysis.project.mcp.servers).length
      } MCP servers`,
    );
    return;
  }

  await runActionInChildProcess(
    state,
    action,
    logger,
    presets.map((preset) => preset.name),
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
  action: Exclude<TuiAction, "init" | "validate">,
  logger: Logger,
  presetNames: readonly string[],
): Promise<void> {
  const entryScript = process.argv[1];
  if (!entryScript) {
    throw new Error("Unable to resolve current CLI entry script.");
  }

  const args = [...process.execArgv, entryScript, action, "--source", planSource(state).sourceDir];
  if (state.platforms.length > 0) args.push("--target", state.platforms.join(","));
  if (presetNames.length > 0) args.push("--preset", presetNames.join(","));

  if (action === "install") {
    args.push("--yes");
    if (planSource(state).globalInstall) args.push("--global");
    if (!state.rebuild) args.push("--no-rebuild");
    if (state.backup) args.push("--backup");
  }

  await new Promise<void>((resolve, reject) => {
    const child = runtimeDependencies.spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ULIS_NON_INTERACTIVE: "1" },
    });

    const stdout = runtimeDependencies.createInterface({ input: child.stdout });
    stdout.on("line", (line) => {
      const text = stripAnsi(line).trim();
      if (text.length > 0) logger.dim(text);
    });

    const stderr = runtimeDependencies.createInterface({ input: child.stderr });
    stderr.on("line", (line) => {
      const text = stripAnsi(line).trim();
      if (text.length > 0) logger.warn(text);
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      stdout.close();
      stderr.close();
      if (code === 0) resolve();
      else reject(new Error(`${action} exited with code ${code ?? "unknown"}`));
    });
  });
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/gu, "");
}

export const __test = {
  setRuntimeDependencies(overrides: Partial<RuntimeDependencies>): void {
    runtimeDependencies = { ...runtimeDependencies, ...overrides };
  },
  resetRuntimeDependencies(): void {
    runtimeDependencies = { ...defaultRuntimeDependencies };
  },
};
